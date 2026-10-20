/**
 * Repository layer for retrieval attempts
 * All database access for retrieval attempts goes through this module
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { mapRecallStateRow } from '@/server/repositories/recallStates';
import type {
  RecallState,
  ReviewHistoryItem,
  Review,
  UUID,
  Timestamp,
  Probability,
  Confidence,
  LatencyMs,
  ModelVersion,
  ReviewMode,
  RetrievalAttemptInput,
} from '@/types';

interface RetrievalAttemptRow {
  id: string;
  user_id: string;
  concept_id: string;
  session_id: string | null;
  presented_at: string;
  answered_at: string;
  elapsed_since_previous_review_hours: number | null;
  predicted_recall_probability: number;
  actual_correctness: boolean;
  self_reported_confidence: number | null;
  response_latency_ms: number;
  model_version: string;
  scheduler_version: string;
  review_mode: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function mapRetrievalAttemptRow(row: RetrievalAttemptRow): Review {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    conceptId: row.concept_id as UUID,
    sessionId: row.session_id as UUID | null,
    presentedAt: row.presented_at as Timestamp,
    answeredAt: row.answered_at as Timestamp,
    elapsedSincePreviousReviewHours: row.elapsed_since_previous_review_hours,
    predictedRecallProbability: row.predicted_recall_probability as Probability,
    actualCorrectness: row.actual_correctness,
    selfReportedConfidence: row.self_reported_confidence as Confidence | null,
    responseLatencyMs: row.response_latency_ms as LatencyMs,
    modelVersion: row.model_version as ModelVersion,
    schedulerVersion: row.scheduler_version as ModelVersion,
    reviewMode: row.review_mode as ReviewMode,
    metadata: row.metadata,
  };
}

export async function createRetrievalAttempt(input: RetrievalAttemptInput): Promise<Review> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('retrieval_attempts')
    .insert({
      user_id: user.id,
      concept_id: input.conceptId,
      session_id: input.sessionId,
      presented_at: now,
      answered_at: now,
      elapsed_since_previous_review_hours: input.elapsedSincePreviousReviewHours,
      predicted_recall_probability: input.predictedRecallProbability,
      actual_correctness: input.actualCorrectness,
      self_reported_confidence: input.selfReportedConfidence,
      response_latency_ms: input.responseLatencyMs,
      model_version: input.modelVersion,
      scheduler_version: input.schedulerVersion,
      review_mode: input.reviewMode,
      metadata: input.metadata ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create retrieval attempt: ${error.message}`);
  return mapRetrievalAttemptRow(data);
}

export async function getRetrievalAttempts(
  conceptId: UUID,
  limit?: number
): Promise<Review[]> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  let query = supabase
    .from('retrieval_attempts')
    .select()
    .eq('concept_id', conceptId)
    .eq('user_id', user.id)
    .order('answered_at', { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to get retrieval attempts: ${error.message}`);
  return (data ?? []).map(mapRetrievalAttemptRow);
}

export async function getUserRetrievalAttempts(
  userId: UUID,
  since?: Date,
  limit?: number
): Promise<Review[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('retrieval_attempts')
    .select()
    .eq('user_id', userId)
    .order('answered_at', { ascending: false });

  if (since) {
    query = query.gte('answered_at', since.toISOString());
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to get user retrieval attempts: ${error.message}`);
  return (data ?? []).map(mapRetrievalAttemptRow);
}

export interface SubmitReviewTxInput {
  attempt: {
    conceptId: UUID;
    sessionId: UUID | null;
    clientRequestId: UUID | null;
    presentedAt: Timestamp;
    answeredAt: Timestamp;
    elapsedSincePreviousReviewHours: number | null;
    predictedRecallProbability: Probability;
    actualCorrectness: boolean;
    selfReportedConfidence: Confidence | null;
    responseLatencyMs: LatencyMs;
    modelVersion: ModelVersion;
    schedulerVersion: ModelVersion;
    reviewMode: ReviewMode;
    metadata: Record<string, unknown> | null;
  };
  state: {
    modelVersion: ModelVersion;
    estimatedHalfLifeHours: number;
    repetitionCount: number;
    successfulRecallCount: number;
    lapseCount: number;
    lastReviewedAt: Timestamp | null;
    nextReviewAt: Timestamp | null;
    lastPredictedRecallProbability: number | null;
  };
}

/**
 * Inserts the attempt and upserts the recall state in ONE Postgres transaction (submit_review_tx).
 * A repeated clientRequestId writes nothing and returns the original attempt with duplicate: true.
 */
export async function submitReviewTx(input: SubmitReviewTxInput): Promise<{
  attempt: Review;
  recallState: RecallState;
  duplicate: boolean;
}> {
  const supabase = await createSupabaseServerClient();
  const { attempt: a, state: s } = input;

  const { data, error } = await supabase.rpc('submit_review_tx', {
    p_attempt: {
      concept_id: a.conceptId,
      session_id: a.sessionId,
      client_request_id: a.clientRequestId,
      presented_at: a.presentedAt,
      answered_at: a.answeredAt,
      elapsed_since_previous_review_hours: a.elapsedSincePreviousReviewHours,
      predicted_recall_probability: a.predictedRecallProbability,
      actual_correctness: a.actualCorrectness,
      self_reported_confidence: a.selfReportedConfidence,
      response_latency_ms: a.responseLatencyMs,
      model_version: a.modelVersion,
      scheduler_version: a.schedulerVersion,
      review_mode: a.reviewMode,
      metadata: a.metadata,
    },
    p_state: {
      model_version: s.modelVersion,
      estimated_half_life_hours: s.estimatedHalfLifeHours,
      repetition_count: s.repetitionCount,
      successful_recall_count: s.successfulRecallCount,
      lapse_count: s.lapseCount,
      last_reviewed_at: s.lastReviewedAt,
      next_review_at: s.nextReviewAt,
      last_predicted_recall_probability: s.lastPredictedRecallProbability,
    },
  });

  if (error) {
    if (error.code === 'P0002') throw new Error('Concept not found');
    if (error.code === '28000') throw new Error('Unauthorized');
    throw new Error(`Failed to submit review: ${error.message}`);
  }

  return {
    attempt: mapRetrievalAttemptRow(data.attempt),
    recallState: mapRecallStateRow(data.state),
    duplicate: data.duplicate === true,
  };
}

export interface ListAttemptsParams {
  conceptId?: UUID;
  result?: 'correct' | 'incorrect';
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** Newest-first page of the signed-in user's attempts, joined with the concept's prompt and subject. */
export async function listAttempts(params: ListAttemptsParams): Promise<{ items: ReviewHistoryItem[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  let query = supabase
    .from('retrieval_attempts')
    .select('*, concepts!inner(prompt, subject)', { count: 'exact' })
    .eq('user_id', user.id)
    .order('answered_at', { ascending: false });

  if (params.conceptId) query = query.eq('concept_id', params.conceptId);
  if (params.result) query = query.eq('actual_correctness', params.result === 'correct');
  if (params.from) query = query.gte('answered_at', params.from);
  if (params.to) query = query.lte('answered_at', params.to);

  const start = (params.page - 1) * params.pageSize;
  const { data, error, count } = await query.range(start, start + params.pageSize - 1);
  if (error) throw new Error(`Failed to list review history: ${error.message}`);

  const items = (data ?? []).map((row: any) => ({
    ...mapRetrievalAttemptRow(row),
    conceptPrompt: row.concepts?.prompt ?? '',
    conceptSubject: row.concepts?.subject ?? '',
  }));
  return { items, total: count ?? items.length };
}

export async function getAttemptsBySession(sessionId: UUID): Promise<Review[]> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('retrieval_attempts')
    .select()
    .eq('session_id', sessionId)
    .eq('user_id', user.id);
  if (error) throw new Error(`Failed to get session attempts: ${error.message}`);
  return (data ?? []).map(mapRetrievalAttemptRow);
}