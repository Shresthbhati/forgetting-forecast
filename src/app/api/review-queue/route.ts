/**
 * Review queue endpoint
 * GET /api/review-queue
 */

import { getPrioritizedReviewQueue } from '@/server/services/forecasting';
import { validateOrThrow, reviewQueueParamsSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const GET = createApiHandler(async request => {
  const params = validateOrThrow(reviewQueueParamsSchema, Object.fromEntries(new URL(request.url).searchParams));
  const items = await getPrioritizedReviewQueue(params.mode ?? 'due', params.subject, params.maxItems ?? 20);
  return jsonResponse({ items });
});
