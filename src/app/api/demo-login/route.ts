/**
 * POST /api/demo-login
 * One-click sign-in to the public demo account. The demo password stays on the server (DEMO_PASSWORD), so it never
 * appears in client code; the account holds only simulated sample data and cannot be deleted.
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { getEnv } from '@/lib/env';
import { ServiceUnavailableError, UnauthorizedError, createApiHandler, jsonResponse } from '@/server/errors';

const DEMO_EMAIL = 'demo@forgetting-forecast.test';

export const POST = createApiHandler(async () => {
  const { DEMO_PASSWORD } = getEnv();
  if (!DEMO_PASSWORD) throw new ServiceUnavailableError('The demo account is not configured on this server');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (error) throw new UnauthorizedError('Could not sign in to the demo account. Has the demo data been seeded?');
  return jsonResponse({ ok: true });
});
