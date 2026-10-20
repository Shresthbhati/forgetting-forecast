/**
 * Application service for the signed-in user's account: profile settings, data export, deletion.
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { createSupabaseAdminClient } from '@/server/db/admin';
import { ForbiddenError, NotFoundError } from '@/server/errors';
import type { Me } from '@/types';

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  return { supabase, user };
}

function mapProfile(row: any, email: string | null): Me {
  return {
    id: row.id,
    email,
    displayName: row.display_name,
    preferredTimezone: row.preferred_timezone ?? 'UTC',
    dailyGoal: row.daily_goal,
    targetRecall: row.target_recall,
    isDemo: row.is_demo === true,
  };
}

export async function getMe(): Promise<Me> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!data) throw new NotFoundError('Profile');
  return mapProfile(data, user.email ?? null);
}

export interface UpdateMeInput {
  displayName?: string | null;
  preferredTimezone?: string;
  dailyGoal?: number;
  targetRecall?: number;
}

/** is_demo is deliberately not part of this input and a database trigger also refuses to change it for users. */
export async function updateMe(input: UpdateMeInput): Promise<Me> {
  const { supabase, user } = await requireUser();
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.preferredTimezone !== undefined) patch.preferred_timezone = input.preferredTimezone;
  if (input.dailyGoal !== undefined) patch.daily_goal = input.dailyGoal;
  if (input.targetRecall !== undefined) patch.target_recall = input.targetRecall;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    if (error) throw new Error(`Failed to update profile: ${error.message}`);
  }
  return getMe();
}

const EXPORT_TABLES = [
  'concepts',
  'recall_states',
  'retrieval_attempts',
  'study_sessions',
  'forecast_log',
  'forecast_evaluations',
  'sources',
  'source_sections',
  'source_terms',
  'exams',
] as const;

/** PostgREST returns at most 1000 rows per request, so each table is read in pages. */
async function readAll(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, table: string, userId: string) {
  const rows: unknown[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId).range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to export ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

export async function exportMyData(): Promise<Record<string, unknown>> {
  const { supabase, user } = await requireUser();
  const profile = await getMe();
  const tables: Record<string, unknown[]> = {};
  for (const table of EXPORT_TABLES) tables[table] = await readAll(supabase, table, user.id);
  return { exportedAt: new Date().toISOString(), profile, ...tables };
}

/** Removes the user's uploaded files; rows cascade with the account, but Storage objects do not. */
async function removeStoredFiles(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) {
  const bucket = supabase.storage.from('sources');
  for (;;) {
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error) throw new Error(`Failed to list stored files: ${error.message}`);
    if (!data || data.length === 0) return;
    const { error: removeError } = await bucket.remove(data.map(f => `${userId}/${f.name}`));
    if (removeError) throw new Error(`Failed to delete stored files: ${removeError.message}`);
  }
}

/** Deletes the auth user; foreign-key cascades remove every row the user owns. The demo account is protected. */
export async function deleteMe(): Promise<void> {
  const { supabase, user } = await requireUser();
  const me = await getMe();
  if (me.isDemo) throw new ForbiddenError('The demo account cannot be deleted');

  await removeStoredFiles(supabase, user.id);

  const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(user.id);
  if (error) throw new Error(`Failed to delete account: ${error.message}`);
}
