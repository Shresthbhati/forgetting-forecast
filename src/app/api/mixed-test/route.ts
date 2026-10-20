/**
 * GET /api/mixed-test?size=10&subjects=DBMS,Physics&seed=
 * A test across subjects: concepts are sampled with weight (1 - predicted recall) x (1 + 0.3 x lapses), interleaved so
 * no subject runs more than twice in a row, and (for concepts made from a source) asked as a DIFFERENT generated item
 * than last time. Answer with POST /api/reviews (reviewMode "practice").
 */

import { buildMixedTestForUser } from '@/server/services/mixedTest';
import { validateOrThrow, mixedTestParamsSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const runtime = 'nodejs';

export const GET = createApiHandler(async request => {
  const params = validateOrThrow(mixedTestParamsSchema, Object.fromEntries(new URL(request.url).searchParams));
  return jsonResponse(await buildMixedTestForUser(params));
});
