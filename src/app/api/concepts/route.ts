/**
 * Concepts list and create endpoint
 * GET /api/concepts
 * POST /api/concepts
 */

import { createConceptWithState, listConceptsWithState } from '@/server/services/concepts';
import { validateOrThrow, readJsonBody, createConceptSchema, paginationSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';
import { enforceWriteRateLimit } from '@/server/rateLimit';

export const GET = createApiHandler(async request => {
  const url = new URL(request.url);
  const params = validateOrThrow(paginationSchema, {
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  });
  const subject = url.searchParams.get('subject') || undefined;
  const includeArchived = url.searchParams.get('includeArchived') === 'true';

  // ponytail: one recall_states query per concept; switch to a joined select if pages get slow.
  const rows = await listConceptsWithState({
    subject,
    includeArchived,
    limit: params.pageSize,
    offset: (params.page - 1) * params.pageSize,
  });
  const concepts = rows.map(({ concept, recallState }) => ({ ...concept, recallState }));
  return jsonResponse({ concepts, page: params.page, pageSize: params.pageSize });
});

export const POST = createApiHandler(async request => {
  await enforceWriteRateLimit('concepts');
  const input = validateOrThrow(createConceptSchema, await readJsonBody(request));
  return jsonResponse(await createConceptWithState(input), 201);
});
