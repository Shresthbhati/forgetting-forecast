/**
 * YouTube sources (captions only)
 * POST /api/sources/youtube   { url, subject } a video link -> one source; a playlist link -> a group of sources
 */

import { importYoutube } from '@/server/services/sources';
import { validateOrThrow, importYoutubeSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse, UnauthorizedError, ValidationError } from '@/server/errors';
import { getUserId } from '@/server/db/supabase';
import { enforceWriteRateLimit } from '@/server/rateLimit';

export const runtime = 'nodejs';
// A playlist import fetches up to 25 transcripts one after another.
export const maxDuration = 120;

export const POST = createApiHandler(async request => {
  if (!(await getUserId())) throw new UnauthorizedError();
  await enforceWriteRateLimit('sources');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('Request body must be JSON');
  }
  const input = validateOrThrow(importYoutubeSchema, body);
  const result = await importYoutube(input);
  const created = result.items.some(i => i.status === 'imported' || i.status === 'failed');
  return jsonResponse(result, created ? 201 : 200);
});
