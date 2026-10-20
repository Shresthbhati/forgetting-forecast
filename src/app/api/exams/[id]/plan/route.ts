/**
 * GET /api/exams/:id/plan
 * Syllabus coverage and a day-by-day revision plan for the exam. The syllabus is the sections of the user's ready
 * sources for the exam's subject; "covered" means at least one concept was made from the section.
 * { exam, plan: { daysLeft, status, coverage, topics (by risk), days: [{ date, tasks, estimatedReviews, overloaded }], warnings } }
 */

import { getExamPlan } from '@/server/services/exams';
import { validateOrThrow, examIdParamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = createApiHandler<Ctx>(async (_request, _requestId, { params }) => {
  const { id } = validateOrThrow(examIdParamSchema, await params);
  return jsonResponse(await getExamPlan(id));
});
