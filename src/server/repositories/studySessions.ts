/**
 * Repository layer for study sessions (every query is scoped to the signed-in user)
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import type { UUID, Timestamp } from '@/types';

export interface StudySession {
  id: UUID;
  userId: UUID;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  mode: 'due' | 'practice' | 'experiment';
  conceptCount: number;
  summary: Record<string, unknown> | null;
}

interface StudySessionRow {
  id: string;
  user_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  mode: string;
  concept_count: number;
  summary: Record<string, unknown> | null;
  created_at: string;
}

function mapStudySessionRow(row: StudySessionRow): StudySession {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    startedAt: row.started_at as Timestamp,
    completedAt: row.completed_at as Timestamp | null,
    status: row.status as StudySession['status'],
    mode: row.mode as StudySession['mode'],
    conceptCount: row.concept_count,
    summary: row.summary,
  };
}

export interface CreateSessionInput {
  mode: 'due' | 'practice' | 'experiment';
}

export async function createSession(input: CreateSessionInput): Promise<StudySession> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('study_sessions')
    .insert({
      user_id: user.id,
      started_at: now,
      completed_at: null,
      status: 'in_progress',
      mode: input.mode,
      concept_count: 0,
      summary: null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create study session: ${error.message}`);
  return mapStudySessionRow(data);
}

export async function getSession(id: UUID): Promise<StudySession | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('study_sessions')
    .select()
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get study session: ${error.message}`);
  }
  return mapStudySessionRow(data);
}

export async function completeSession(
  id: UUID,
  conceptCount: number,
  summary: Record<string, unknown>
): Promise<StudySession> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('study_sessions')
    .update({
      completed_at: now,
      status: 'completed',
      concept_count: conceptCount,
      summary,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to complete study session: ${error.message}`);
  return mapStudySessionRow(data);
}

export async function abandonSession(
  id: UUID,
  conceptCount = 0,
  summary: Record<string, unknown> | null = null
): Promise<StudySession> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('study_sessions')
    .update({
      completed_at: now,
      status: 'abandoned',
      concept_count: conceptCount,
      summary,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to abandon study session: ${error.message}`);
  return mapStudySessionRow(data);
}

export async function getRecentSessions(userId: UUID, limit = 10): Promise<StudySession[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('study_sessions')
    .select()
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to get recent sessions: ${error.message}`);
  return (data ?? []).map(mapStudySessionRow);
}