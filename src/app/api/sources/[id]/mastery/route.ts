/**
 * GET /api/sources/:id/mastery
 * Per-topic (section heading) mastery for the concepts made from this source. `mastery` is null and
 * `insufficientData` true below 5 attempts: nothing is invented from a handful of answers.
 */

import { getSourceMastery } from '@/server/services/sources';
import { validateOrThrow, sourceIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = createApiHandler<Ctx>(async (_request, _requestId, { params }) => {
  const { id } = validateOrThrow(sourceIdParamSchema, await params);
  return jsonResponse(await getSourceMastery(id));
});
