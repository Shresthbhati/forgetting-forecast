/**
 * Individual concept endpoint
 * GET /api/concepts/:id
 * PATCH /api/concepts/:id
 * DELETE /api/concepts/:id
 */

import { updateConcept, deleteConcept } from '@/server/repositories/concepts';
import { getConceptWithState } from '@/server/services/concepts';
import { validateOrThrow, readJsonBody, conceptIdParamSchema, updateConceptSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse, NotFoundError } from '@/server/errors';

type Ctx = { params: Promise<{ id: string }> };

export const GET = createApiHandler<Ctx>(async (_request, _requestId, { params }) => {
  const { id } = await params;
  validateOrThrow(conceptIdParamSchema, { id });

  const found = await getConceptWithState(id);
  if (!found) throw new NotFoundError('Concept');
  return jsonResponse({ ...found.concept, recallState: found.recallState });
});

export const PATCH = createApiHandler<Ctx>(async (request, _requestId, { params }) => {
  const { id } = await params;
  validateOrThrow(conceptIdParamSchema, { id });
  const input = validateOrThrow(updateConceptSchema, await readJsonBody(request));
  return jsonResponse(await updateConcept(id, input));
});

export const DELETE = createApiHandler<Ctx>(async (_request, _requestId, { params }) => {
  const { id } = await params;
  validateOrThrow(conceptIdParamSchema, { id });
  await deleteConcept(id);
  return new Response(null, { status: 204 });
});
