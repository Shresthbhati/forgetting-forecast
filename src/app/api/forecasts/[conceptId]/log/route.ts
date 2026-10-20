/**
 * GET /api/forecasts/:conceptId/log
 * Immutable forecast log for a concept; each entry is pending, evaluated or expired.
 */

import { getConceptForecastLog } from '@/server/services/forecasting';
import { validateOrThrow, conceptIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const GET = createApiHandler<{ params: Promise<{ conceptId: string }> }>(async (_request, _requestId, { params }) => {
  const { conceptId } = await params;
  validateOrThrow(conceptIdParamSchema, { id: conceptId });
  return jsonResponse({ forecasts: await getConceptForecastLog(conceptId) });
});
