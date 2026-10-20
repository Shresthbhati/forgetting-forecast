/**
 * POST /api/reviews  submit one review (atomic, idempotent via clientRequestId)
 * GET  /api/reviews  paginated review history (?conceptId=&result=correct|incorrect&from=&to=&page=&pageSize=)
 */

import { submitReview, listReviewHistory } from '@/server/services/reviews';
import { validateOrThrow, readJsonBody, submitReviewSchema, reviewHistoryParamsSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';
import { enforceWriteRateLimit } from '@/server/rateLimit';

export const POST = createApiHandler(async request => {
  await enforceWriteRateLimit('reviews');
  const input = validateOrThrow(submitReviewSchema, await readJsonBody(request));
  const result = await submitReview(input);
  return jsonResponse(result, result.duplicate ? 200 : 201);
});

export const GET = createApiHandler(async request => {
  const params = validateOrThrow(reviewHistoryParamsSchema, Object.fromEntries(new URL(request.url).searchParams));
  return jsonResponse(await listReviewHistory(params));
});
