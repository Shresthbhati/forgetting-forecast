/**
 * Repository reads for mixed tests: the source terms behind concepts, and which question types a concept last got.
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import type { SourceLocation } from '@/domain/ingestion/types';
import type { UUID } from '@/types';

export interface TermRow {
  id: UUID;
  sourceId: UUID;
  sectionId: UUID | null;
  term: string;
  definition: string;
  location: SourceLocation;
}

/** Defined terms of the given sources, keyed `${sourceId}|${lower-cased term}`. */
export async function listDefinedTermsBySource(sourceIds: UUID[]): Promise<Map<string, TermRow>> {
  const out = new Map<string, TermRow>();
  if (sourceIds.length === 0) return out;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('source_terms')
    .select('id, source_id, section_id, term, definition, location')
    .in('source_id', sourceIds)
    .not('definition', 'is', null);
  if (error) throw new Error(`Failed to list terms: ${error.message}`);
  for (const r of data ?? []) {
    out.set(`${r.source_id}|${(r.term as string).toLowerCase()}`, {
      id: r.id as UUID, sourceId: r.source_id as UUID, sectionId: r.section_id as UUID | null,
      term: r.term as string, definition: r.definition as string, location: (r.location ?? {}) as SourceLocation,
    });
  }
  return out;
}

const RECENT_PER_CONCEPT = 6;

// ponytail: PostgREST returns at most 1000 rows; the newest attempts come first, which is what variant choice needs.
/** Per concept: the question types of its last answers (from attempt metadata), most recent first. */
export async function listRecentQuestionTypes(conceptIds: UUID[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (conceptIds.length === 0) return out;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('retrieval_attempts')
    .select('concept_id, metadata, answered_at')
    .in('concept_id', conceptIds)
    .order('answered_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Failed to list recent attempts: ${error.message}`);
  for (const r of data ?? []) {
    const type = (r.metadata as { questionType?: unknown } | null)?.questionType;
    if (typeof type !== 'string') continue;
    const list = (out[r.concept_id as string] ??= []);
    if (list.length < RECENT_PER_CONCEPT) list.push(type);
  }
  return out;
}
