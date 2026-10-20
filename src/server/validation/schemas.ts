/**
 * Validation schemas for API inputs
 * All external input must be validated through these schemas
 */

import { z } from 'zod/v4';
import { ValidationError } from '@/server/errors';

// UUID validation
export const uuidSchema = z.uuid({ message: 'Invalid UUID format' });

// Pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

// Concept schemas
export const createConceptSchema = z.object({
  subject: z.string().min(1).max(100),
  topic: z.string().max(100).nullable().optional(),
  prompt: z.string().min(1).max(5000),
  answer: z.string().min(1).max(5000),
  explanation: z.string().max(5000).nullable().optional(),
  difficulty: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(50)).max(20).optional(),
  sourceReference: z.string().max(500).nullable().optional(),
});

export const updateConceptSchema = createConceptSchema.partial().extend({
  archivedAt: z.string().datetime().nullable().optional(),
});

export const conceptIdParamSchema = z.object({
  id: uuidSchema,
});

// Review queue params
export const reviewQueueParamsSchema = z.object({
  mode: z.enum(['due', 'practice', 'experiment']).optional(),
  subject: z.string().max(100).optional(),
  topic: z.string().max(100).optional(),
  maxItems: z.coerce.number().int().positive().max(100).optional(),
  forecastHorizonHours: z.coerce.number().int().positive().max(8760).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

// Review submission
export const MAX_RESPONSE_LATENCY_MS = 30 * 60 * 1000;

export const submitReviewSchema = z.object({
  conceptId: uuidSchema,
  sessionId: uuidSchema.nullish(),
  /** Idempotency key: re-posting the same id returns the original attempt (duplicate: true). */
  clientRequestId: uuidSchema.optional(),
  actualCorrectness: z.boolean(),
  /** Preferred: the 1-5 rating shown in the UI. Normalized to 0-1 in ONE place (confidenceFromLevel in the domain engine). */
  confidenceLevel: z.number().int().min(1).max(5).nullish(),
  /** Legacy: already-normalized 0-1 confidence. Ignored when confidenceLevel is given. */
  selfReportedConfidence: z.number().min(0).max(1).nullable().optional(),
  responseLatencyMs: z.number().int().min(0).max(MAX_RESPONSE_LATENCY_MS),
  reviewMode: z.enum(['due', 'practice', 'experiment']),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

// Review history
export const reviewHistoryParamsSchema = z.object({
  conceptId: uuidSchema.optional(),
  result: z.enum(['correct', 'incorrect']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

// Session completion (counts are always computed server-side from the session's attempts)
export const finishSessionSchema = z.object({
  status: z.enum(['completed', 'abandoned']),
});

// Account
export const updateMeSchema = z.object({
  displayName: z.string().min(1).max(100).nullable().optional(),
  preferredTimezone: z.string().min(1).max(64).optional(),
  dailyGoal: z.number().int().min(1).max(500).optional(),
  targetRecall: z.number().min(0.5).max(0.99).optional(),
}).strict();

export const deleteMeSchema = z.object({
  confirm: z.literal('DELETE'),
});

// Forecast params
export const forecastParamsSchema = z.object({
  horizonsHours: z.array(z.number().int().positive().max(8760)).optional(),
});

// Study session
export const createSessionSchema = z.object({
  mode: z.enum(['due', 'practice', 'experiment']),
});

export const sessionIdParamSchema = z.object({
  id: uuidSchema,
});

// Analytics params
export const analyticsParamsSchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

// Type inference helpers
export type PaginationParams = z.infer<typeof paginationSchema>;
export type CreateConceptInput = z.infer<typeof createConceptSchema>;
export type UpdateConceptInput = z.infer<typeof updateConceptSchema>;
export type ConceptIdParam = z.infer<typeof conceptIdParamSchema>;
export type ReviewQueueParams = z.infer<typeof reviewQueueParamsSchema>;
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
export type ForecastParams = z.infer<typeof forecastParamsSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SessionIdParam = z.infer<typeof sessionIdParamSchema>;
export type AnalyticsParams = z.infer<typeof analyticsParamsSchema>;

// Generic API response helpers
export function validateOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(errors);
  }
  return result.data;
}

/** Parses a JSON request body; malformed JSON is a 400, not a 500. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

// Reuse the AppError subclass so errorResponse returns 400, not 500.
export { ValidationError };

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}