/**
 * GET /api/sources/:id/quiz?sectionId=&seed=
 * A rule-generated quiz for one section: definition recall, cloze, term-to-definition multiple choice, true/false and
 * numericals from formulas. Questions are labelled "Generated from p. N". `seed` makes a quiz reproducible.
 */

import { buildSectionQuiz } from '@/server/services/sources';
import { validateOrThrow, quizParamsSchema, sourceIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = createApiHandler<Ctx>(async (request, _requestId, { params }) => {
  const { id } = validateOrThrow(sourceIdParamSchema, await params);
  const query = validateOrThrow(quizParamsSchema, Object.fromEntries(new URL(request.url).searchParams));
  return jsonResponse(await buildSectionQuiz(id, query.sectionId, query.seed));
});
