/**
 * GET /api/concepts/:id/detail
 * Concept, recall state, forecast (1d/7d/30d), last 50 attempts and the real scheduling-priority factors.
 */

import { getConceptDetail } from '@/server/services/forecasting';
import { validateOrThrow, conceptIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const GET = createApiHandler<{ params: Promise<{ id: string }> }>(async (_request, _requestId, { params }) => {
  const { id } = validateOrThrow(conceptIdParamSchema, await params);
  return jsonResponse(await getConceptDetail(id));
});
