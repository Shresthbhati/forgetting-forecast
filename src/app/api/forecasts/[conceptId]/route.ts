/**
 * Concept forecast endpoint
 * GET /api/forecasts/:conceptId
 */

import { getConceptForecast } from '@/server/services/forecasting';
import { validateOrThrow, conceptIdParamSchema, forecastParamsSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const GET = createApiHandler<{ params: Promise<{ conceptId: string }> }>(async (request, _requestId, { params }) => {
  const { conceptId } = await params;
  validateOrThrow(conceptIdParamSchema, { id: conceptId });

  const { searchParams } = new URL(request.url);
  const { horizonsHours } = validateOrThrow(forecastParamsSchema, {
    horizonsHours: searchParams.get('horizonsHours')?.split(',').map(Number),
  });

  return jsonResponse(await getConceptForecast(conceptId, horizonsHours));
});
