/**
 * PATCH /api/sessions/:id  { status: 'completed' | 'abandoned' }
 * Counts and the summary are computed server-side from the session's own attempts.
 */

import { finishReviewSession } from '@/server/services/reviews';
import { validateOrThrow, readJsonBody, finishSessionSchema, sessionIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const PATCH = createApiHandler<{ params: Promise<{ id: string }> }>(async (request, _requestId, { params }) => {
  const { id } = validateOrThrow(sessionIdParamSchema, await params);
  const { status } = validateOrThrow(finishSessionSchema, await readJsonBody(request));
  return jsonResponse(await finishReviewSession(id, status));
});
