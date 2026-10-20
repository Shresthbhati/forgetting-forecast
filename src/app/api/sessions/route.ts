/**
 * POST /api/sessions  start a study session -> { sessionId }
 */

import { startReviewSession } from '@/server/services/reviews';
import { validateOrThrow, readJsonBody, createSessionSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';
import { enforceWriteRateLimit } from '@/server/rateLimit';

export const POST = createApiHandler(async request => {
  await enforceWriteRateLimit('sessions');
  const { mode } = validateOrThrow(createSessionSchema, await readJsonBody(request));
  return jsonResponse(await startReviewSession(mode), 201);
});
