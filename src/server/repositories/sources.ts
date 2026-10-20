/**
 * Repository layer for uploaded sources, their sections and terms, and the private `sources` storage bucket.
 * All access goes through the caller's Supabase session, so Row Level Security applies to every query.
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import type { SourceKind, SourceLocation } from '@/domain/ingestion/types';
import type { Source, SourceSection, SourceStatus, SourceTerm, Timestamp, UUID } from '@/types';

export const SOURCES_BUCKET = 'sources';
/** Postgres unique_violation, raised when the same file (user_id, sha256) is inserted twice. */
const UNIQUE_VIOLATION = '23505';

interface SourceRow {
  id: string;
  user_id: string;
  subject: string;
  title: string;
  kind: SourceKind;
  storage_path: string;
  byte_size: number;
  sha256: string;
  status: SourceStatus;
  error: string | null;
  unit_count: number | null;
  created_at: string;
  updated_at: string;
}

interface SectionRow {
  id: string;
  source_id: string;
  ordinal: number;
  level: number;
  heading: string;
  text: string;
  location: SourceLocation;
  char_count: number;
}

interface TermRow {
  id: string;
  source_id: string;
  section_id: string | null;
  term: string;
  definition: string | null;
  location: SourceLocation;
  score: number;
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    subject: row.subject,
    title: row.title,
    kind: row.kind,
    storagePath: row.storage_path,
    byteSize: row.byte_size,
    sha256: row.sha256,
    status: row.status,
    error: row.error,
    unitCount: row.unit_count,
    createdAt: row.created_at as Timestamp,
    updatedAt: row.updated_at as Timestamp,
  };
}

const mapSection = (row: SectionRow): SourceSection => ({
  id: row.id as UUID,
  sourceId: row.source_id as UUID,
  ordinal: row.ordinal,
  level: row.level,
  heading: row.heading,
  text: row.text,
  location: row.location ?? {},
  charCount: row.char_count,
});

const mapTerm = (row: TermRow): SourceTerm => ({
  id: row.id as UUID,
  sourceId: row.source_id as UUID,
  sectionId: row.section_id as UUID | null,
  term: row.term,
  definition: row.definition,
  location: row.location ?? {},
  score: row.score,
});

async function client() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  return { supabase, userId: user.id as UUID };
}

export async function getCurrentUserId(): Promise<UUID> {
  return (await client()).userId;
}

export async function listSources(): Promise<Source[]> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase
    .from('sources')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to list sources: ${error.message}`);
  return (data ?? []).map(mapSource);
}

export async function getSource(id: UUID): Promise<Source | null> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase.from('sources').select().eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Failed to get source: ${error.message}`);
  return data ? mapSource(data) : null;
}

export async function findSourceByHash(sha256: string): Promise<Source | null> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase.from('sources').select().eq('user_id', userId).eq('sha256', sha256).maybeSingle();
  if (error) throw new Error(`Failed to look up source: ${error.message}`);
  return data ? mapSource(data) : null;
}

export interface InsertSourceInput {
  id: UUID;
  subject: string;
  title: string;
  kind: SourceKind;
  storagePath: string;
  byteSize: number;
  sha256: string;
}

/** Inserts the row in `processing` state. Returns null when the same file already exists (unique on user + sha256). */
export async function insertSource(input: InsertSourceInput): Promise<Source | null> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase
    .from('sources')
    .insert({
      id: input.id,
      user_id: userId,
      subject: input.subject,
      title: input.title,
      kind: input.kind,
      storage_path: input.storagePath,
      byte_size: input.byteSize,
      sha256: input.sha256,
      status: 'processing',
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw new Error(`Failed to create source: ${error.message}`);
  }
  return mapSource(data);
}

export async function markSourceFailed(id: UUID, message: string): Promise<Source> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase
    .from('sources')
    .update({ status: 'failed', error: message.slice(0, 500) })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw new Error(`Failed to mark source failed: ${error.message}`);
  return mapSource(data);
}

export interface IngestPayload {
  unitCount: number;
  sections: Array<{ ordinal: number; level: number; heading: string; text: string; location: SourceLocation }>;
  terms: Array<{ term: string; definition: string | null; section_ordinal: number; location: SourceLocation; score: number }>;
}

/** Writes sections + terms and flips the source to `ready` in ONE transaction (ingest_source_tx). */
export async function ingestSource(id: UUID, payload: IngestPayload): Promise<void> {
  const { supabase } = await client();
  const { error } = await supabase.rpc('ingest_source_tx', {
    p_source_id: id,
    p_unit_count: payload.unitCount,
    p_sections: payload.sections,
    p_terms: payload.terms,
  });
  if (error) throw new Error(`Failed to save parsed source: ${error.message}`);
}

export async function listSections(sourceId: UUID): Promise<SourceSection[]> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase
    .from('source_sections')
    .select()
    .eq('source_id', sourceId)
    .eq('user_id', userId)
    .order('ordinal');
  if (error) throw new Error(`Failed to list sections: ${error.message}`);
  return (data ?? []).map(mapSection);
}

export async function listTerms(sourceId: UUID): Promise<SourceTerm[]> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase
    .from('source_terms')
    .select()
    .eq('source_id', sourceId)
    .eq('user_id', userId)
    .order('score', { ascending: false });
  if (error) throw new Error(`Failed to list terms: ${error.message}`);
  return (data ?? []).map(mapTerm);
}

export async function getTermsByIds(sourceId: UUID, ids: UUID[]): Promise<SourceTerm[]> {
  if (ids.length === 0) return [];
  const { supabase, userId } = await client();
  const { data, error } = await supabase.from('source_terms').select().eq('source_id', sourceId).eq('user_id', userId).in('id', ids);
  if (error) throw new Error(`Failed to get terms: ${error.message}`);
  return (data ?? []).map(mapTerm);
}

export async function getSectionsByIds(sourceId: UUID, ids: UUID[]): Promise<SourceSection[]> {
  if (ids.length === 0) return [];
  const { supabase, userId } = await client();
  const { data, error } = await supabase.from('source_sections').select().eq('source_id', sourceId).eq('user_id', userId).in('id', ids);
  if (error) throw new Error(`Failed to get sections: ${error.message}`);
  return (data ?? []).map(mapSection);
}

/** Section texts from the subject's other ready sources, used for subject-wide TF-IDF. Bounded to keep ingestion fast. */
export async function listSubjectSectionTexts(subject: string, excludeSourceId: UUID, limit = 400): Promise<string[]> {
  const { supabase, userId } = await client();
  const { data: others, error } = await supabase
    .from('sources')
    .select('id')
    .eq('user_id', userId)
    .eq('subject', subject)
    .eq('status', 'ready')
    .neq('id', excludeSourceId);
  if (error) throw new Error(`Failed to list subject sources: ${error.message}`);
  const ids = (others ?? []).map(r => r.id);
  if (ids.length === 0) return [];
  const { data, error: sectionError } = await supabase
    .from('source_sections')
    .select('text')
    .eq('user_id', userId)
    .in('source_id', ids)
    .limit(limit);
  if (sectionError) throw new Error(`Failed to list subject sections: ${sectionError.message}`);
  return (data ?? []).map(r => r.text as string);
}

/** Deletes the row; sections and terms cascade, and concepts made from it keep their text but lose the link (SET NULL). */
export async function deleteSource(id: UUID): Promise<void> {
  const { supabase, userId } = await client();
  const { error } = await supabase.from('sources').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(`Failed to delete source: ${error.message}`);
}

export async function uploadObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { supabase } = await client();
  const { error } = await supabase.storage.from(SOURCES_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Failed to store file: ${error.message}`);
}

export async function removeObject(path: string): Promise<void> {
  const { supabase } = await client();
  const { error } = await supabase.storage.from(SOURCES_BUCKET).remove([path]);
  if (error) throw new Error(`Failed to delete stored file: ${error.message}`);
}

/** Prompts of the concepts already made from this source, so "Add all" twice does not create duplicates. */
export async function listConceptPromptsForSource(sourceId: UUID): Promise<Set<string>> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase.from('concepts').select('prompt').eq('user_id', userId).eq('source_id', sourceId);
  if (error) throw new Error(`Failed to list source concepts: ${error.message}`);
  return new Set((data ?? []).map(r => (r.prompt as string).trim().toLowerCase()));
}

export interface SourceConceptRow {
  id: UUID;
  prompt: string;
  topic: string | null;
  sourceSectionId: UUID | null;
}

/** Concepts made from this source (active ones), with the prompt used to match them back to their term. */
export async function listSourceConcepts(sourceId: UUID): Promise<SourceConceptRow[]> {
  const { supabase, userId } = await client();
  const { data, error } = await supabase
    .from('concepts')
    .select('id, prompt, topic, source_section_id')
    .eq('user_id', userId)
    .eq('source_id', sourceId)
    .is('archived_at', null);
  if (error) throw new Error(`Failed to list source concepts: ${error.message}`);
  return (data ?? []).map(r => ({ id: r.id as UUID, prompt: r.prompt as string, topic: r.topic as string | null, sourceSectionId: r.source_section_id as UUID | null }));
}

/** Defined terms across the user's ready sources in a subject: the pool wrong multiple-choice options come from. */
export async function listSubjectDefinedTerms(subject: string, limit = 400): Promise<Array<{ term: string; definition: string }>> {
  const { supabase, userId } = await client();
  const { data: sourceRows, error } = await supabase
    .from('sources')
    .select('id')
    .eq('user_id', userId)
    .eq('subject', subject)
    .eq('status', 'ready');
  if (error) throw new Error(`Failed to list subject sources: ${error.message}`);
  const ids = (sourceRows ?? []).map(r => r.id);
  if (ids.length === 0) return [];
  const { data, error: termError } = await supabase
    .from('source_terms')
    .select('term, definition')
    .eq('user_id', userId)
    .in('source_id', ids)
    .not('definition', 'is', null)
    .order('score', { ascending: false })
    .limit(limit);
  if (termError) throw new Error(`Failed to list subject terms: ${termError.message}`);
  return (data ?? []).map(r => ({ term: r.term as string, definition: r.definition as string }));
}

export interface AttemptRow {
  conceptId: UUID;
  correct: boolean;
  answeredAt: string;
}

// ponytail: PostgREST returns at most 1000 rows; page this read if one source's history grows past that.
export async function listAttemptsForConcepts(conceptIds: UUID[]): Promise<AttemptRow[]> {
  if (conceptIds.length === 0) return [];
  const { supabase, userId } = await client();
  const { data, error } = await supabase
    .from('retrieval_attempts')
    .select('concept_id, actual_correctness, answered_at')
    .eq('user_id', userId)
    .in('concept_id', conceptIds);
  if (error) throw new Error(`Failed to list attempts: ${error.message}`);
  return (data ?? []).map(r => ({ conceptId: r.concept_id as UUID, correct: r.actual_correctness as boolean, answeredAt: r.answered_at as string }));
}
