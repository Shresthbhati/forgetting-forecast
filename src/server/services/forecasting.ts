/**
 * Application service for forecasting
 * Provides forecast generation for concepts and review queue prioritization
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { getConcept } from '@/server/repositories/concepts';
import { getOrCreateRecallState } from '@/server/repositories/recallStates';
import { getReviewQueue as getReviewQueueRepo, getDashboardSummary } from '@/server/repositories/analytics';
import { getRetrievalAttempts } from '@/server/repositories/retrievalAttempts';
import { listForecastLog } from '@/server/repositories/forecasts';
import { generateForecast, generateHorizonForecasts, calculateSchedulingPriority } from '@/domain/forecasting/engine';
import { FORECAST_HORIZONS_HOURS } from '@/domain/forecasting/evaluation';
import type {
  ConceptDetail,
  ForecastLogEntry,
  Concept,
  RecallState,
  ForecastResult,
  ReviewQueueItem,
  DashboardSummary,
  UUID,
  ModelVersion,
  Timestamp,
} from '@/types';

export async function getConceptForecast(
  conceptId: UUID,
  horizonsHours?: number[]
): Promise<{
  concept: Concept;
  recallState: RecallState;
  currentForecast: ForecastResult;
  horizonForecasts: Array<{ horizonHours: number; forecast: ForecastResult }>;
}> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const concept = await getConcept(conceptId);
  if (!concept) throw new Error('Concept not found');
  if (concept.userId !== user.id) throw new Error('Access denied');

  const recallState = await getOrCreateRecallState(
    concept.id,
    24,
    'exponential-half-life-v1'
  );

  const currentForecast = generateForecast({
    concept,
    recallState,
    at: new Date(),
  });

  const horizonForecasts = horizonsHours
    ? generateHorizonForecasts(concept, recallState, horizonsHours, new Date())
    : [];

  return {
    concept,
    recallState,
    currentForecast,
    horizonForecasts,
  };
}

export async function getReviewQueue(
  mode: 'due' | 'practice' | 'experiment' = 'due',
  subject?: string,
  maxItems = 20
): Promise<ReviewQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  return getReviewQueueRepo(mode, subject, maxItems);
}

export async function getPrioritizedReviewQueue(
  mode: 'due' | 'practice' | 'experiment' = 'due',
  subject?: string,
  maxItems = 20
): Promise<Array<ReviewQueueItem & { schedulingFactors: Awaited<ReturnType<typeof calculateSchedulingPriority>>['factors'] }>> {
  const items = await getReviewQueue(mode, subject, maxItems);

  // Add scheduling factors to each item
  const enriched = await Promise.all(items.map(async item => {
    const scheduling = calculateSchedulingPriority({
      concept: item.concept,
      recallState: item.recallState,
      now: new Date(),
    });
    return { ...item, schedulingFactors: scheduling.factors };
  }));

  // Sort by priority score (highest first)
  return enriched.sort((a, b) => b.priorityScore - a.priorityScore);
}

export async function getDashboard(): Promise<DashboardSummary> {
  return getDashboardSummary();
}

/** Everything the concept page needs in one call, including the real scheduling-priority factors. */
export async function getConceptDetail(conceptId: UUID): Promise<ConceptDetail> {
  const concept = await getConcept(conceptId);
  if (!concept) throw new Error('Concept not found');

  const recallState = await getOrCreateRecallState(concept.id, 24, 'exponential-half-life-v1');
  const now = new Date();

  return {
    concept,
    recallState,
    forecast: generateForecast({ concept, recallState, at: now }),
    horizonForecasts: generateHorizonForecasts(concept, recallState, [...FORECAST_HORIZONS_HOURS], now),
    attempts: await getRetrievalAttempts(concept.id, 50),
    priority: calculateSchedulingPriority({ concept, recallState, now }),
  };
}

export async function getConceptForecastLog(conceptId: UUID): Promise<ForecastLogEntry[]> {
  const concept = await getConcept(conceptId);
  if (!concept) throw new Error('Concept not found');
  return listForecastLog(concept.id, new Date());
}

export async function getConceptsWithForecasts(): Promise<Array<{
  concept: Concept;
  recallState: RecallState;
  forecast: ForecastResult;
}>> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('concepts')
    .select(`
      *,
      recall_states (
        estimated_half_life_hours,
        repetition_count,
        successful_recall_count,
        lapse_count,
        last_reviewed_at,
        next_review_at,
        last_predicted_recall_probability,
        model_version
      )
    `)
    .eq('user_id', user.id)
    .is('archived_at', null);

  if (error) throw new Error(`Failed to get concepts: ${error.message}`);

  return (data ?? []).map(row => {
    const rs = row.recall_states?.[0];
    const recallState: RecallState = rs ? {
      conceptId: row.id as UUID,
      userId: row.user_id as UUID,
      modelVersion: (rs.model_version ?? 'exponential-half-life-v1') as ModelVersion,
      initialStabilityDays: 1.0,
      estimatedHalfLifeHours: rs.estimated_half_life_hours as any,
      repetitionCount: rs.repetition_count,
      successfulRecallCount: rs.successful_recall_count,
      lapseCount: rs.lapse_count,
      lastReviewedAt: rs.last_reviewed_at as Timestamp | null,
      nextReviewAt: rs.next_review_at as Timestamp | null,
      lastPredictedRecallProbability: rs.last_predicted_recall_probability as any,
      updatedAt: new Date().toISOString() as Timestamp,
    } : {
      conceptId: row.id as UUID,
      userId: row.user_id as UUID,
      modelVersion: 'exponential-half-life-v1' as ModelVersion,
      initialStabilityDays: 1.0,
      estimatedHalfLifeHours: 24 as any,
      repetitionCount: 0,
      successfulRecallCount: 0,
      lapseCount: 0,
      lastReviewedAt: null,
      nextReviewAt: null,
      lastPredictedRecallProbability: null,
      updatedAt: new Date().toISOString() as Timestamp,
    };

    const concept: Concept = {
      id: row.id as UUID,
      userId: row.user_id as UUID,
      subject: row.subject,
      topic: row.topic,
      prompt: row.prompt,
      answer: row.answer,
      explanation: row.explanation,
      difficulty: row.difficulty as any,
      tags: row.tags ?? [],
      sourceReference: row.source_reference,
      sourceId: row.source_id ?? null,
      sourceSectionId: row.source_section_id ?? null,
      sourceLocation: row.source_location ?? null,
      archivedAt: row.archived_at as Timestamp | null,
      createdAt: row.created_at as Timestamp,
      updatedAt: row.updated_at as Timestamp,
    };

    const forecast = generateForecast({
      concept,
      recallState,
      at: new Date(),
    });

    return { concept, recallState, forecast };
  });
}