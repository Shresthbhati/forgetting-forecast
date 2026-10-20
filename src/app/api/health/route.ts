/**
 * Health check endpoint
 * GET /api/health
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { getEnv } from '@/lib/env';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const GET = createApiHandler(async () => {
  const env = getEnv();
  const supabase = await createSupabaseServerClient();

  // A trivial query proves the database is reachable; a policy error still means the API answered.
  let dbStatus = 'unknown';
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);
    dbStatus = error ? 'error' : 'healthy';
  } catch {
    dbStatus = 'error';
  }

  return jsonResponse({
    status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    environment: env.NODE_ENV,
    checks: {
      database: dbStatus,
      supabase: env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'not configured',
    },
  });
});
