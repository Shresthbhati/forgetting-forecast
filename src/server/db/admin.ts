/**
 * Supabase service-role client. SERVER ONLY: it bypasses Row Level Security.
 * Use it for the few operations that need it (deleting an auth user); never for ordinary user requests.
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getEnv } from '@/lib/env';

export function createSupabaseAdminClient() {
  const env = getEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
