/**
 * Repository layer for recall states
 * All database access for recall states goes through this module
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import type { RecallState, UUID, Timestamp, HalfLifeHours, ModelVersion } from '@/types';

interface RecallStateRow {
  concept_id: string;
  user_id: string;
  model_version: string;
  initial_stability_days: number;
  estimated_half_life_hours: number;
  repetition_count: number;
  successful_recall_count: number;
  lapse_count: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  last_predicted_recall_probability: number | null;
  updated_at: string;
}

export function mapRecallStateRow(row: RecallStateRow): RecallState {
  return {
    conceptId: row.concept_id as UUID,
    userId: row.user_id as UUID,
    modelVersion: row.model_version as ModelVersion,
    initialStabilityDays: row.initial_stability_days,
    estimatedHalfLifeHours: row.estimated_half_life_hours as HalfLifeHours,
    repetitionCount: row.repetition_count,
    successfulRecallCount: row.successful_recall_count,
    lapseCount: row.lapse_count,
    lastReviewedAt: row.last_reviewed_at as Timestamp | null,
    nextReviewAt: row.next_review_at as Timestamp | null,
    lastPredictedRecallProbability: row.last_predicted_recall_probability as number | null,
    updatedAt: row.updated_at as Timestamp,
  };
}

export interface CreateRecallStateInput {
  conceptId: UUID;
  initialStabilityDays?: number;
  estimatedHalfLifeHours: HalfLifeHours;
  modelVersion: ModelVersion;
}

export interface UpdateRecallStateInput {
  estimatedHalfLifeHours?: HalfLifeHours;
  repetitionCount?: number;
  successfulRecallCount?: number;
  lapseCount?: number;
  lastReviewedAt?: Timestamp | null;
  nextReviewAt?: Timestamp | null;
  lastPredictedRecallProbability?: number | null;
  modelVersion?: ModelVersion;
}

export async function createRecallState(input: CreateRecallStateInput): Promise<RecallState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('recall_states')
    .insert({
      concept_id: input.conceptId,
      user_id: user.id,
      model_version: input.modelVersion,
      initial_stability_days: input.initialStabilityDays ?? 1.0,
      estimated_half_life_hours: input.estimatedHalfLifeHours,
      repetition_count: 0,
      successful_recall_count: 0,
      lapse_count: 0,
      last_reviewed_at: null,
      next_review_at: null,
      last_predicted_recall_probability: null,
      updated_at: now,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create recall state: ${error.message}`);
  return mapRecallStateRow(data);
}

export async function getRecallState(conceptId: UUID): Promise<RecallState | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('recall_states')
    .select()
    .eq('concept_id', conceptId)
    .eq('user_id', user.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get recall state: ${error.message}`);
  }
  return mapRecallStateRow(data);
}

export async function updateRecallState(conceptId: UUID, input: UpdateRecallStateInput): Promise<RecallState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.estimatedHalfLifeHours !== undefined) updates.estimated_half_life_hours = input.estimatedHalfLifeHours;
  if (input.repetitionCount !== undefined) updates.repetition_count = input.repetitionCount;
  if (input.successfulRecallCount !== undefined) updates.successful_recall_count = input.successfulRecallCount;
  if (input.lapseCount !== undefined) updates.lapse_count = input.lapseCount;
  if (input.lastReviewedAt !== undefined) updates.last_reviewed_at = input.lastReviewedAt;
  if (input.nextReviewAt !== undefined) updates.next_review_at = input.nextReviewAt;
  if (input.lastPredictedRecallProbability !== undefined) updates.last_predicted_recall_probability = input.lastPredictedRecallProbability;
  if (input.modelVersion !== undefined) updates.model_version = input.modelVersion;

  const { data, error } = await supabase
    .from('recall_states')
    .update(updates)
    .eq('concept_id', conceptId)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update recall state: ${error.message}`);
  return mapRecallStateRow(data);
}

export async function getOrCreateRecallState(
  conceptId: UUID,
  initialHalfLifeHours: HalfLifeHours,
  modelVersion: ModelVersion
): Promise<RecallState> {
  let state = await getRecallState(conceptId);
  if (state) return state;
  return createRecallState({
    conceptId,
    estimatedHalfLifeHours: initialHalfLifeHours,
    modelVersion,
  });
}