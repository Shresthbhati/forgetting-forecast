/**
 * Application service for review submission, history and study sessions
 * Handles the complete review pipeline: validation, prediction, one atomic write, forecast logging
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { getConcept } from '@/server/repositories/concepts';
import { getOrCreateRecallState } from '@/server/repositories/recallStates';
import { getTargetRecall } from '@/server/repositories/profile';
import { submitReviewTx, listAttempts, getAttemptsBySession } from '@/server/repositories/retrievalAttempts';
import { createSession, completeSession, abandonSession, getSession, type StudySession } from '@/server/repositories/studySessions';
import { getPendingForecasts, insertEvaluations, insertForecasts } from '@/server/repositories/forecasts';
import {
  MODEL_VERSION,
  SCHEDULER_VERSION,
  calculateRecallProbability,
  confidenceFromLevel,
  generateForecast,
  updateRecallState as updateRecallStateDomain,
} from '@/domain/forecasting/engine';
import { FORECAST_HORIZONS_HOURS, evaluateForecasts } from '@/domain/forecasting/evaluation';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import type {
  Concept,
  RecallState,
  Review,
  ReviewHistoryPage,
  ReviewMode,
  Probability,
  RetrievalAttemptInput,
  SessionSummary,
  Timestamp,
  UUID,
} from '@/types';

export interface SubmitReviewInput {
  conceptId: UUID;
  sessionId?: UUID | null;
  clientRequestId?: UUID;
  actualCorrectness: boolean;
  /** 1-5 UI rating; converted to the stored 0-1 value by confidenceFromLevel (the single normalization point). */
  confidenceLevel?: number | null;
  /** Legacy 0-1 value, used only when confidenceLevel is absent. */
  selfReportedConfidence?: number | null;
  responseLatencyMs: number;
  reviewMode: ReviewMode;
  metadata?: Record<string, unknown> | null;
}

export interface SubmitReviewResult {
  attempt: Review;
  concept: Concept;
  updatedRecallState: RecallState;
  forecast: ReturnType<typeof generateForecast>;
  nextReviewAt: Timestamp;
  /** True when clientRequestId was already used: nothing was written and the original attempt is returned. */
  duplicate: boolean;
}

export async function submitReview(input: SubmitReviewInput): Promise<SubmitReviewResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // 1. A session id must belong to the caller and still be in progress (another user's id is simply "not found").
  if (input.sessionId) {
    const session = await getSession(input.sessionId);
    if (!session) throw new NotFoundError('Session');
    if (session.status !== 'in_progress') throw new ValidationError('Session is not in progress');
  }

  // 2. Concept and ownership
  const concept = await getConcept(input.conceptId);
  if (!concept) throw new Error('Concept not found');
  if (concept.userId !== user.id) throw new Error('Access denied');

  // 3. Current state (created on first review)
  const recallState = await getOrCreateRecallState(concept.id, 24, MODEL_VERSION);
  const targetRecall = await getTargetRecall();
  const now = new Date();
  const elapsedSincePreviousReviewHours = recallState.lastReviewedAt
    ? (now.getTime() - new Date(recallState.lastReviewedAt).getTime()) / 3_600_000
    : null;

  // 4. Predict from the stored state BEFORE the outcome is applied. Never trust a client-sent prediction:
  //    these rows are the calibration data the model is evaluated on.
  const predictedRecallProbability = calculateRecallProbability(concept, recallState, now);
  const selfReportedConfidence =
    input.confidenceLevel != null ? confidenceFromLevel(input.confidenceLevel) : input.selfReportedConfidence ?? null;

  const attemptInput: RetrievalAttemptInput = {
    conceptId: input.conceptId,
    sessionId: input.sessionId ?? null,
    elapsedSincePreviousReviewHours,
    predictedRecallProbability,
    actualCorrectness: input.actualCorrectness,
    selfReportedConfidence,
    responseLatencyMs: input.responseLatencyMs,
    reviewMode: input.reviewMode,
    modelVersion: MODEL_VERSION,
    schedulerVersion: SCHEDULER_VERSION,
    metadata: input.metadata ?? null,
  };

  // 5. New state from the pure domain engine (timestamps are server-set; the client never supplies them).
  const domainResult = updateRecallStateDomain({ concept, recallState, attempt: attemptInput, now, targetRecall });
  const next = domainResult.recallState;

  // 6. ONE atomic write: attempt + recall state in a single transaction, idempotent on clientRequestId.
  const tx = await submitReviewTx({
    attempt: {
      conceptId: input.conceptId,
      sessionId: input.sessionId ?? null,
      clientRequestId: input.clientRequestId ?? null,
      presentedAt: new Date(now.getTime() - input.responseLatencyMs).toISOString() as Timestamp,
      answeredAt: now.toISOString() as Timestamp,
      elapsedSincePreviousReviewHours,
      predictedRecallProbability,
      actualCorrectness: input.actualCorrectness,
      selfReportedConfidence,
      responseLatencyMs: input.responseLatencyMs,
      modelVersion: MODEL_VERSION,
      schedulerVersion: SCHEDULER_VERSION,
      reviewMode: input.reviewMode,
      metadata: input.metadata ?? null,
    },
    state: {
      modelVersion: next.modelVersion,
      estimatedHalfLifeHours: next.estimatedHalfLifeHours,
      repetitionCount: next.repetitionCount,
      successfulRecallCount: next.successfulRecallCount,
      lapseCount: next.lapseCount,
      lastReviewedAt: next.lastReviewedAt,
      nextReviewAt: next.nextReviewAt,
      lastPredictedRecallProbability: next.lastPredictedRecallProbability,
    },
  });

  // 7. Forecast log (best effort: a logging failure must never lose a committed review).
  if (!tx.duplicate) {
    try {
      await logAndEvaluateForecasts(concept, tx.attempt, tx.recallState, now, targetRecall);
    } catch (error) {
      console.error('[reviews] forecast logging failed:', error instanceof Error ? error.message : 'unknown error');
    }
  }

  const forecast = generateForecast({ concept, recallState: tx.recallState, at: now, targetRecall });
  return {
    attempt: tx.attempt,
    concept,
    updatedRecallState: tx.recallState,
    forecast,
    nextReviewAt: (tx.recallState.nextReviewAt ?? domainResult.nextReviewAt) as Timestamp,
    duplicate: tx.duplicate,
  };
}

/**
 * Evaluates this concept's earlier forecasts against the new attempt (window rule: see
 * domain/forecasting/evaluation.ts), then logs fresh 1d/7d/30d forecasts from the updated state.
 */
async function logAndEvaluateForecasts(concept: Concept, attempt: Review, state: RecallState, now: Date, targetRecall: Probability): Promise<void> {
  const pending = await getPendingForecasts(concept.id);
  await insertEvaluations(
    evaluateForecasts(pending, {
      id: attempt.id,
      answeredAt: attempt.answeredAt,
      actualCorrectness: attempt.actualCorrectness,
    })
  );

  await insertForecasts(
    FORECAST_HORIZONS_HOURS.map(horizonHours => {
      const targetAt = new Date(now.getTime() + horizonHours * 3_600_000);
      const forecast = generateForecast({ concept, recallState: state, at: targetAt, targetRecall });
      return {
        conceptId: concept.id,
        generatedAt: now.toISOString() as Timestamp,
        horizonHours,
        targetAt: targetAt.toISOString() as Timestamp,
        predictedProbability: forecast.probability,
        modelVersion: forecast.modelVersion,
        inputSnapshot: state,
        sourceAttemptId: attempt.id,
      };
    })
  );
}

// ---- Study sessions ----

export async function startReviewSession(mode: ReviewMode = 'due'): Promise<{ sessionId: UUID }> {
  const session = await createSession({ mode });
  return { sessionId: session.id };
}

function summarizeAttempts(attempts: Review[]): SessionSummary {
  const rated = attempts.filter(a => a.selfReportedConfidence !== null);
  return {
    total: attempts.length,
    correct: attempts.filter(a => a.actualCorrectness).length,
    averageConfidence: rated.length > 0
      ? rated.reduce((sum, a) => sum + (a.selfReportedConfidence ?? 0), 0) / rated.length
      : null,
  };
}

/** Counts and summary always come from this session's stored attempts, never from the client. */
export async function finishReviewSession(id: UUID, status: 'completed' | 'abandoned'): Promise<StudySession> {
  const session = await getSession(id);
  if (!session) throw new NotFoundError('Session');
  if (session.status !== 'in_progress') throw new ConflictError('Session already finished');

  const attempts = await getAttemptsBySession(id);
  const conceptCount = new Set(attempts.map(a => a.conceptId)).size;
  const summary = summarizeAttempts(attempts) as unknown as Record<string, unknown>;

  // An abandoned session keeps its attempts; only the session row is closed.
  return status === 'completed'
    ? completeSession(id, conceptCount, summary)
    : abandonSession(id, conceptCount, summary);
}

// ---- History ----

export async function listReviewHistory(params: {
  conceptId?: UUID;
  result?: 'correct' | 'incorrect';
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}): Promise<ReviewHistoryPage> {
  const { items, total } = await listAttempts(params);
  return { items, total, page: params.page, pageSize: params.pageSize };
}
