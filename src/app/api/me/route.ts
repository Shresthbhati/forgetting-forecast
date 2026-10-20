/**
 * GET    /api/me  profile + email
 * PATCH  /api/me  { displayName?, preferredTimezone?, dailyGoal?, targetRecall? }
 * DELETE /api/me  { confirm: "DELETE" } deletes the account and all its data (the demo account cannot be deleted)
 */

import { getMe, updateMe, deleteMe } from '@/server/services/account';
import { validateOrThrow, readJsonBody, updateMeSchema, deleteMeSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse } from '@/server/errors';
import { enforceWriteRateLimit } from '@/server/rateLimit';

export const GET = createApiHandler(async () => jsonResponse(await getMe()));

export const PATCH = createApiHandler(async request => {
  const input = validateOrThrow(updateMeSchema, await readJsonBody(request));
  return jsonResponse(await updateMe(input));
});

export const DELETE = createApiHandler(async request => {
  await enforceWriteRateLimit('account-delete');
  validateOrThrow(deleteMeSchema, await readJsonBody(request));
  await deleteMe();
  return new Response(null, { status: 204 });
});
