/**
 * Uploaded study material
 * GET  /api/sources   list the signed-in user's sources and playlist groups
 * POST /api/sources   multipart upload: file, subject, title? (PDF, PPTX, DOCX, TXT, MD; max 20 MB)
 */

import { listUserSourceGroups, listUserSources, uploadSource } from '@/server/services/sources';
import { validateOrThrow, uploadSourceFieldsSchema } from '@/server/validation/schemas';
import { createApiHandler, jsonResponse, UnauthorizedError, ValidationError } from '@/server/errors';
import { getUserId } from '@/server/db/supabase';
import { enforceWriteRateLimit } from '@/server/rateLimit';
import { MAX_UPLOAD_BYTES } from '@/domain/ingestion/types';

// pdf.js / mammoth / jszip need Node APIs, and parsing a large file can take a while.
export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = createApiHandler(async () => {
  const [sources, groups] = await Promise.all([listUserSources(), listUserSourceGroups()]);
  return jsonResponse({ sources, groups });
});

export const POST = createApiHandler(async request => {
  // Authenticate before buffering a large body.
  if (!(await getUserId())) throw new UnauthorizedError();
  await enforceWriteRateLimit('sources');

  // Refuse oversized bodies before buffering them (the multipart envelope adds a little overhead).
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) throw new ValidationError('The file is larger than the 20 MB limit');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError('Request must be multipart/form-data with a file');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new ValidationError('A file is required');
  if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError('The file is larger than the 20 MB limit');

  const fields = validateOrThrow(uploadSourceFieldsSchema, {
    subject: form.get('subject') ?? undefined,
    title: (form.get('title') as string | null) || undefined,
  });

  const result = await uploadSource({
    filename: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    subject: fields.subject,
    title: fields.title,
  });
  return jsonResponse(result, result.duplicate ? 200 : 201);
});
