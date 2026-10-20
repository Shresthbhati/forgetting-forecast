/**
 * POST /api/sources/:id/concepts
 * Creates concepts from selected terms ({type:'term', termId}) or passages ({type:'passage', sectionId, prompt, answer}).
 * Every concept keeps its source, section and page/slide. Returns { created, skipped }.
 */

import { createConceptsFromSource } from '@/server/services/sources';
import { validateOrThrow, readJsonBody, sourceIdParamSchema, createConceptsFromSourceSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';
import { enforceWriteRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const POST = createApiHandler<Ctx>(async (request, _requestId, { params }) => {
  await enforceWriteRateLimit('source-concepts');
  const { id } = validateOrThrow(sourceIdParamSchema, await params);
  const input = validateOrThrow(createConceptsFromSourceSchema, await readJsonBody(request));
  return jsonResponse(await createConceptsFromSource(id, input), 201);
});
