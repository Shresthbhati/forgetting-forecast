/**
 * Dashboard summary endpoint
 * GET /api/dashboard
 */

import { getDashboard } from '@/server/services/forecasting';
import { createApiHandler, jsonResponse } from '@/server/errors';

export const GET = createApiHandler(async () => jsonResponse(await getDashboard()));
