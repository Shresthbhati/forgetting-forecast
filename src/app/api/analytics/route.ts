/**
 * Analytics endpoint
 * GET /api/analytics
 */

import { getAnalyticsSummary } from '@/server/repositories/analytics';
import { validateOrThrow, analyticsParamsSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const GET = createApiHandler(async request => {
  validateOrThrow(analyticsParamsSchema, Object.fromEntries(new URL(request.url).searchParams));
  return jsonResponse(await getAnalyticsSummary());
});
