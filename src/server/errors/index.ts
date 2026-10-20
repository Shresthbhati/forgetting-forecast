/**
 * Standardized error handling for API routes
 */

export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: ApiError;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

export class InternalError extends AppError {
  constructor(message = 'An internal error occurred', details?: Record<string, unknown>) {
    super('INTERNAL_ERROR', message, 500, details);
    this.name = 'InternalError';
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, slow down') {
    super('RATE_LIMITED', message, 429);
    this.name = 'TooManyRequestsError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super('SERVICE_UNAVAILABLE', message, 503);
    this.name = 'ServiceUnavailableError';
  }
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function toApiError(error: unknown, requestId: string): ApiError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    // Structured line with the requestId; never the stack or payload (prompts/answers must not reach logs).
    console.error(JSON.stringify({ level: 'error', requestId, code: 'INTERNAL_ERROR', errorName: error.name }));
    return {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unknown error occurred',
    requestId,
  };
}

// Services throw plain Errors with these messages; map them so callers get 401/403/404 instead of 500.
function normalizeError(error: unknown): unknown {
  if (error instanceof AppError || !(error instanceof Error)) return error;
  if (error.message === 'Unauthorized') return new UnauthorizedError();
  if (error.message === 'Access denied') return new ForbiddenError();
  if (error.message === 'Concept not found') return new NotFoundError('Concept');
  return error;
}

export function errorResponse(rawError: unknown, requestId?: string): Response {
  const error = normalizeError(rawError);
  const id = requestId ?? generateRequestId();
  const apiError = toApiError(error, id);
  const statusCode = error instanceof AppError ? error.statusCode : 500;

  return new Response(JSON.stringify({ error: apiError }), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': id,
    },
  });
}

export async function handleApiRoute(
  handler: (request: Request, requestId: string) => Promise<Response>
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    return await handler(new Request('internal', { method: 'GET' }), requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Wraps a route handler: generates the requestId, sets X-Request-ID, and turns any thrown error into the
 * standard { error: { code, message, requestId } } shape. `context` carries Next's { params } for dynamic routes.
 */
export function createApiHandler<C = unknown>(
  handler: (request: Request, requestId: string, context: C) => Promise<Response>
) {
  // `context` is required (not optional) so Next's generated route types accept dynamic-segment handlers.
  return async (request: Request, context: C): Promise<Response> => {
    const requestId = generateRequestId();
    const route = new URL(request.url).pathname;

    try {
      const response = await handler(request, requestId, context);
      response.headers.set('X-Request-ID', requestId);
      return response;
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        console.warn(JSON.stringify({ level: 'warn', requestId, route, method: request.method, code: error.code, status: error.statusCode }));
      } else if (error instanceof AppError) {
        console.error(JSON.stringify({ level: 'error', requestId, route, method: request.method, code: error.code, status: error.statusCode }));
      }
      return errorResponse(error, requestId);
    }
  };
}