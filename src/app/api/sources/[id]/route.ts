/**
 * One uploaded source
 * GET    /api/sources/:id   the source with its outline (sections) and detected terms
 * DELETE /api/sources/:id   deletes the row, its sections/terms and the stored file
 */

import { deleteUserSource, getSourceDetail } from '@/server/services/sources';
import { validateOrThrow, sourceIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';
import { enforceWriteRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = createApiHandler<Ctx>(async (_request, _requestId, { params }) => {
  const { id } = validateOrThrow(sourceIdParamSchema, await params);
  return jsonResponse(await getSourceDetail(id));
});

export const DELETE = createApiHandler<Ctx>(async (_request, _requestId, { params }) => {
  await enforceWriteRateLimit('sources');
  const { id } = validateOrThrow(sourceIdParamSchema, await params);
  await deleteUserSource(id);
  return new Response(null, { status: 204 });
});
