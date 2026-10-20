/**
 * Application service for concept management
 * Orchestrates repositories and domain logic for concept-related use cases
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { createConcept, getConcept, listConcepts, updateConcept, archiveConcept, deleteConcept, getConceptsWithRecallState } from '@/server/repositories/concepts';
import { createRecallState, getOrCreateRecallState } from '@/server/repositories/recallStates';
import { initializeRecallState } from '@/domain/forecasting/engine';
import type { Concept, UUID, Difficulty, CreateConceptInput, UpdateConceptInput } from '@/types';

export async function createConceptWithState(input: CreateConceptInput): Promise<Concept> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Create the concept
  const concept = await createConcept(input);

  // Initialize recall state
  const initialHalfLife = 24; // Default 24 hours
  await createRecallState({
    conceptId: concept.id,
    estimatedHalfLifeHours: initialHalfLife,
    modelVersion: 'exponential-half-life-v1',
  });

  return concept;
}

export async function getConceptWithState(conceptId: UUID): Promise<{
  concept: Concept;
  recallState: Awaited<ReturnType<typeof getOrCreateRecallState>>;
} | null> {
  const concept = await getConcept(conceptId);
  if (!concept) return null;

  const recallState = await getOrCreateRecallState(
    concept.id,
    24,
    'exponential-half-life-v1'
  );

  return { concept, recallState };
}

export async function listConceptsWithState(params?: {
  subject?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Array<{ concept: Concept; recallState: Awaited<ReturnType<typeof getOrCreateRecallState>> }>> {
  const concepts = await listConcepts(params);
  const results = [];

  for (const concept of concepts) {
    const recallState = await getOrCreateRecallState(
      concept.id,
      24,
      'exponential-half-life-v1'
    );
    results.push({ concept, recallState });
  }

  return results;
}

export async function updateConceptWithValidation(
  conceptId: UUID,
  input: UpdateConceptInput
): Promise<Concept> {
  // Validate concept exists and belongs to user
  const existing = await getConcept(conceptId);
  if (!existing) throw new Error('Concept not found');

  return updateConcept(conceptId, input);
}

export async function archiveConceptById(conceptId: UUID): Promise<Concept> {
  const existing = await getConcept(conceptId);
  if (!existing) throw new Error('Concept not found');

  return archiveConcept(conceptId);
}

export async function deleteConceptById(conceptId: UUID): Promise<void> {
  const existing = await getConcept(conceptId);
  if (!existing) throw new Error('Concept not found');

  await deleteConcept(conceptId);
}

export async function getAllConceptsWithForecasts(): Promise<Array<{
  concept: Concept;
  recallState: Awaited<ReturnType<typeof getOrCreateRecallState>>;
}>> {
  return listConceptsWithState({ includeArchived: false });
}