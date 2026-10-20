/**
 * DELETE /api/exams/:id
 */

import { deleteUserExam } from '@/server/services/exams';
import { validateOrThrow, examIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler } from '@/server/errors';
import { enforceWriteRateLimit } from '@/server/rateLimit';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = createApiHandler<Ctx>(async (_request, _requestId, { params }) => {
  await enforceWriteRateLimit('exams');
  const { id } = validateOrThrow(examIdParamSchema, await params);
  await deleteUserExam(id);
  return new Response(null, { status: 204 });
});
