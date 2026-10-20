/**
 * GET /api/concepts/:id/prerequisites
 * For a concept made from a defined source term: the terms its definition builds on (named in it, defined no later in
 * the source), each with its concept status, plus generated probe questions for the ones that need a check.
 * `struggling` is true when this concept is below target or has lapsed ("Struggling with B -> check A").
 */

import { getConceptPrerequisites } from '@/server/services/knowledge';
import { validateOrThrow, conceptIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = createApiHandler<Ctx>(async (_request, _requestId, { params }) => {
  const { id } = validateOrThrow(conceptIdParamSchema, await params);
  return jsonResponse(await getConceptPrerequisites(id));
});
