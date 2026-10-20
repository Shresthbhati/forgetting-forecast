/**
 * Repository layer for concepts
 * All database access for concepts goes through this module
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import type {
  Concept,
  UUID,
  Timestamp,
  Difficulty,
  ReviewMode,
} from '@/types';

interface ConceptRow {
  id: string;
  user_id: string;
  subject: string;
  topic: string | null;
  prompt: string;
  answer: string;
  explanation: string | null;
  difficulty: number;
  tags: string[];
  source_reference: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapConceptRow(row: ConceptRow): Concept {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    subject: row.subject,
    topic: row.topic,
    prompt: row.prompt,
    answer: row.answer,
    explanation: row.explanation,
    difficulty: row.difficulty as Difficulty,
    tags: row.tags,
    sourceReference: row.source_reference,
    archivedAt: row.archived_at as Timestamp | null,
    createdAt: row.created_at as Timestamp,
    updatedAt: row.updated_at as Timestamp,
  };
}

export interface CreateConceptInput {
  subject: string;
  topic?: string | null;
  prompt: string;
  answer: string;
  explanation?: string | null;
  difficulty: Difficulty;
  tags?: string[];
  sourceReference?: string | null;
}

export interface UpdateConceptInput {
  subject?: string;
  topic?: string | null;
  prompt?: string;
  answer?: string;
  explanation?: string | null;
  difficulty?: Difficulty;
  tags?: string[];
  sourceReference?: string | null;
  archivedAt?: Timestamp | null;
}

export interface ListConceptsParams {
  subject?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export async function createConcept(input: CreateConceptInput): Promise<Concept> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('concepts')
    .insert({
      user_id: user.id,
      subject: input.subject,
      topic: input.topic ?? null,
      prompt: input.prompt,
      answer: input.answer,
      explanation: input.explanation ?? null,
      difficulty: input.difficulty,
      tags: input.tags ?? [],
      source_reference: input.sourceReference ?? null,
      archived_at: null,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create concept: ${error.message}`);
  return mapConceptRow(data);
}

export async function getConcept(id: UUID): Promise<Concept | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('concepts')
    .select()
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get concept: ${error.message}`);
  }
  return mapConceptRow(data);
}

export async function listConcepts(params: ListConceptsParams = {}): Promise<Concept[]> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  let query = supabase
    .from('concepts')
    .select()
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!params.includeArchived) {
    query = query.is('archived_at', null);
  }

  if (params.subject) {
    query = query.eq('subject', params.subject);
  }

  if (params.limit) {
    query = query.limit(params.limit);
  }

  if (params.offset) {
    query = query.range(params.offset, params.offset + (params.limit ?? 20) - 1);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list concepts: ${error.message}`);
  return (data ?? []).map(mapConceptRow);
}

export async function updateConcept(id: UUID, input: UpdateConceptInput): Promise<Concept> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.subject !== undefined) updates.subject = input.subject;
  if (input.topic !== undefined) updates.topic = input.topic;
  if (input.prompt !== undefined) updates.prompt = input.prompt;
  if (input.answer !== undefined) updates.answer = input.answer;
  if (input.explanation !== undefined) updates.explanation = input.explanation;
  if (input.difficulty !== undefined) updates.difficulty = input.difficulty;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.sourceReference !== undefined) updates.source_reference = input.sourceReference;
  if (input.archivedAt !== undefined) updates.archived_at = input.archivedAt;

  const { data, error } = await supabase
    .from('concepts')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update concept: ${error.message}`);
  return mapConceptRow(data);
}

export async function archiveConcept(id: UUID): Promise<Concept> {
  return updateConcept(id, { archivedAt: new Date().toISOString() as Timestamp });
}

export async function unarchiveConcept(id: UUID): Promise<Concept> {
  return updateConcept(id, { archivedAt: null });
}

export async function deleteConcept(id: UUID): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { error } = await supabase
    .from('concepts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) throw new Error(`Failed to delete concept: ${error.message}`);
}

export async function getConceptsWithRecallState(userId: UUID): Promise<Array<{
  concept: Concept;
  recallState: {
    estimatedHalfLifeHours: number;
    repetitionCount: number;
    successfulRecallCount: number;
    lapseCount: number;
    lastReviewedAt: Timestamp | null;
    nextReviewAt: Timestamp | null;
    lastPredictedRecallProbability: number | null;
    modelVersion: string;
  };
}>> {
  const supabase = await createSupabaseServerClient();

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
    .eq('user_id', userId)
    .is('archived_at', null);

  if (error) throw new Error(`Failed to get concepts with recall state: ${error.message}`);

  return (data ?? []).map(row => ({
    concept: mapConceptRow(row),
    recallState: row.recall_states?.[0] ? {
      estimatedHalfLifeHours: row.recall_states[0].estimated_half_life_hours,
      repetitionCount: row.recall_states[0].repetition_count,
      successfulRecallCount: row.recall_states[0].successful_recall_count,
      lapseCount: row.recall_states[0].lapse_count,
      lastReviewedAt: row.recall_states[0].last_reviewed_at as Timestamp | null,
      nextReviewAt: row.recall_states[0].next_review_at as Timestamp | null,
      lastPredictedRecallProbability: row.recall_states[0].last_predicted_recall_probability,
      modelVersion: row.recall_states[0].model_version,
    } : null,
  })).filter(r => r.recallState !== null) as Array<{
    concept: Concept;
    recallState: NonNullable<typeof data[0]['recall_states']>[0];
  }>;
}