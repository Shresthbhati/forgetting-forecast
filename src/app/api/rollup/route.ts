/**
 * GET /api/rollup
 * Predicted recall rolled up from concepts to topics and subjects: { targetRecall, subjects: [{ key, concepts,
 * meanRecall, atRisk, reviewed, lapses, weakest, topics: [...] }] }, weakest first. These are model ESTIMATES.
 */

import { getRecallRollup } from '@/server/services/rollup';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const GET = createApiHandler(async () => jsonResponse(await getRecallRollup()));
