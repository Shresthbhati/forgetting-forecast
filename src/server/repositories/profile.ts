/**
 * Repository for the signed-in user's profile settings that the memory engine reads.
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { DEFAULT_TARGET_RECALL } from '@/domain/forecasting/engine';
import type { Probability } from '@/types';

/** The user's target recall (profile.target_recall, 0.5-0.99); the default 0.8 if it can't be read. */
export async function getTargetRecall(): Promise<Probability> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data, error } = await supabase.from('profiles').select('target_recall').eq('id', user.id).maybeSingle();
  if (error) throw new Error(`Failed to read profile: ${error.message}`);
  const value = Number(data?.target_recall);
  return (Number.isFinite(value) && value >= 0.5 && value <= 0.99 ? value : DEFAULT_TARGET_RECALL) as Probability;
}

/** The user's daily review goal (profile.daily_goal); 20 if it can't be read. */
export async function getDailyGoal(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data, error } = await supabase.from('profiles').select('daily_goal').eq('id', user.id).maybeSingle();
  if (error) throw new Error(`Failed to read profile: ${error.message}`);
  const value = Number(data?.daily_goal);
  return Number.isInteger(value) && value >= 1 ? value : 20;
}
