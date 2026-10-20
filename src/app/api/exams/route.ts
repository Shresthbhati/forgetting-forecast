/**
 * Exams
 * GET  /api/exams   { exams: [{ id, subject, name, examDate, daysLeft }] }, soonest first
 * POST /api/exams   { subject, name, examDate: "YYYY-MM-DD" } -> 201 exam
 */

import { createExam, listUserExams } from '@/server/services/exams';
import { validateOrThrow, readJsonBody, createExamSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';
import { enforceWriteRateLimit } from '@/server/rateLimit';

export const GET = createApiHandler(async () => jsonResponse({ exams: await listUserExams() }));

export const POST = createApiHandler(async request => {
  await enforceWriteRateLimit('exams');
  const input = validateOrThrow(createExamSchema, await readJsonBody(request));
  return jsonResponse(await createExam(input), 201);
});
