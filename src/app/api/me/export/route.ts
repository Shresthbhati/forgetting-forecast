/**
 * GET /api/me/export  every row the user owns as a JSON download
 */

import { exportMyData } from '@/server/services/account';
import { createApiHandler } from '@/server/errors';

export const GET = createApiHandler(async () => {
  const data = await exportMyData();
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="forgetting-forecast-export.json"',
    },
  });
});
