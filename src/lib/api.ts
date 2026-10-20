/**
 * Client-side API utilities
 * Use these functions in React components to call the backend API.
 * Errors thrown here carry the server's message and `code` (see ApiRequestError).
 */

import type { SubjectRollup } from '@/domain/forecasting/rollup';
import type {
  ConceptDetail,
  CreatedFromSource,
  QuizResponse,
  SourceMastery,
  Source,
  SourceDetail,
  UploadSourceResult,
  ForecastLogEntry,
  Me,
  ReviewHistoryPage,
} from '@/types';

const API_BASE = '';

/** Thrown for any non-2xx response; `status` and `code` come from the server's standard error shape. */
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Request failed' } }));
    throw new ApiRequestError(error.error?.message ?? `HTTP ${response.status}`, response.status, error.error?.code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  // Health
  health: () => apiRequest<{ status: string; checks: Record<string, string> }>('/api/health'),

  // Dashboard
  dashboard: () => apiRequest<{
    totalActiveConcepts: number;
    dueConcepts: number;
    reviewsCompletedToday: number;
    reviewsCompletedThisWeek: number;
    meanEstimatedRecall: number;
    nextRecommendedReviews: Array<{
      concept: any;
      forecast: any;
      recallState: any;
    }>;
    recentActivity: any[];
  }>('/api/dashboard'),

  // Concepts
  concepts: {
    list: (params?: { subject?: string; includeArchived?: boolean; page?: number; pageSize?: number }) => {
      const search = new URLSearchParams();
      if (params?.subject) search.set('subject', params.subject);
      if (params?.includeArchived) search.set('includeArchived', 'true');
      if (params?.page) search.set('page', String(params.page));
      if (params?.pageSize) search.set('pageSize', String(params.pageSize));
      return apiRequest<{ concepts: any[]; page: number; pageSize: number }>(`/api/concepts?${search}`);
    },
    create: (input: {
      subject: string;
      topic?: string;
      prompt: string;
      answer: string;
      explanation?: string;
      difficulty: number;
      tags?: string[];
      sourceReference?: string;
    }) => apiRequest<any>('/api/concepts', { method: 'POST', body: JSON.stringify(input) }),
    get: (id: string) => apiRequest<any>(`/api/concepts/${id}`),
    detail: (id: string) => apiRequest<ConceptDetail>(`/api/concepts/${id}/detail`),
    update: (id: string, input: Partial<any>) => apiRequest<any>(`/api/concepts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    delete: (id: string) => apiRequest<void>(`/api/concepts/${id}`, { method: 'DELETE' }),
  },

  // Review queue
  reviewQueue: (params?: {
    mode?: 'due' | 'practice' | 'experiment';
    subject?: string;
    maxItems?: number;
  }) => {
    const search = new URLSearchParams();
    if (params?.mode) search.set('mode', params.mode);
    if (params?.subject) search.set('subject', params.subject);
    if (params?.maxItems) search.set('maxItems', String(params.maxItems));
    return apiRequest<{ items: any[] }>(`/api/review-queue?${search}`);
  },

  // Reviews
  reviews: {
    submit: (input: {
      conceptId: string;
      sessionId?: string | null;
      /** Idempotency key: retry with the same id and the server returns the original attempt (duplicate: true). */
      clientRequestId?: string;
      actualCorrectness: boolean;
      /** 1-5 rating from the UI; the server converts it to the stored 0-1 value. */
      confidenceLevel?: number | null;
      /** Legacy 0-1 value; ignored when confidenceLevel is set. */
      selfReportedConfidence?: number | null;
      responseLatencyMs: number;
      reviewMode: 'due' | 'practice' | 'experiment';
      metadata?: Record<string, unknown>;
    }) => apiRequest<any>('/api/reviews', { method: 'POST', body: JSON.stringify(input) }),
    list: (params?: {
      conceptId?: string;
      result?: 'correct' | 'incorrect';
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    }) => {
      const search = new URLSearchParams();
      Object.entries(params ?? {}).forEach(([k, v]) => v !== undefined && search.set(k, String(v)));
      return apiRequest<ReviewHistoryPage>(`/api/reviews?${search}`);
    },
  },

  // Study sessions (counts are computed server-side)
  sessions: {
    start: (mode: 'due' | 'practice' | 'experiment' = 'due') =>
      apiRequest<{ sessionId: string }>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode }) }),
    finish: (id: string, status: 'completed' | 'abandoned') =>
      apiRequest<{ id: string; status: string; conceptCount: number; summary: Record<string, unknown> | null }>(
        `/api/sessions/${id}`,
        { method: 'PATCH', body: JSON.stringify({ status }) }
      ),
  },

  // Account
  me: {
    get: () => apiRequest<Me>('/api/me'),
    update: (input: { displayName?: string | null; preferredTimezone?: string; dailyGoal?: number; targetRecall?: number }) =>
      apiRequest<Me>('/api/me', { method: 'PATCH', body: JSON.stringify(input) }),
    exportUrl: '/api/me/export',
    delete: () => apiRequest<void>('/api/me', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) }),
  },

  // Forecasts
  forecasts: {
    get: (conceptId: string, horizonsHours?: number[]) => {
      const search = new URLSearchParams();
      if (horizonsHours) search.set('horizonsHours', horizonsHours.join(','));
      return apiRequest<any>(`/api/forecasts/${conceptId}?${search}`);
    },
    log: (conceptId: string) => apiRequest<{ forecasts: ForecastLogEntry[] }>(`/api/forecasts/${conceptId}/log`),
  },

  // Uploaded study material
  sources: {
    list: () => apiRequest<{ sources: Source[] }>('/api/sources'),
    get: (id: string) => apiRequest<SourceDetail>(`/api/sources/${id}`),
    delete: (id: string) => apiRequest<void>(`/api/sources/${id}`, { method: 'DELETE' }),
    quiz: (id: string, sectionId: string, seed?: number) =>
      apiRequest<QuizResponse>(`/api/sources/${id}/quiz?sectionId=${sectionId}${seed === undefined ? '' : `&seed=${seed}`}`),
    mastery: (id: string) => apiRequest<SourceMastery>(`/api/sources/${id}/mastery`),
    createConcepts: (
      id: string,
      input: {
        items: Array<{ type: 'term'; termId: string } | { type: 'passage'; sectionId: string; prompt: string; answer: string }>;
        difficulty?: number;
      }
    ) => apiRequest<CreatedFromSource>(`/api/sources/${id}/concepts`, { method: 'POST', body: JSON.stringify(input) }),
    /**
     * Multipart upload with progress (fetch cannot report upload progress). `onProgress` gets 0-1 while bytes are
     * sent; the promise resolves after the server has finished parsing.
     */
    upload: (file: File, subject: string, onProgress?: (fraction: number) => void) =>
      new Promise<UploadSourceResult>((resolve, reject) => {
        const body = new FormData();
        body.append('file', file);
        body.append('subject', subject);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/api/sources`);
        xhr.responseType = 'json';
        xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
        xhr.onerror = () => reject(new ApiRequestError('Network error while uploading', 0));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as UploadSourceResult);
          else reject(new ApiRequestError(xhr.response?.error?.message ?? `HTTP ${xhr.status}`, xhr.status, xhr.response?.error?.code));
        };
        xhr.send(body);
      }),
  },

  // Predicted recall rolled up to topics and subjects
  rollup: () => apiRequest<{ targetRecall: number; subjects: SubjectRollup[] }>('/api/rollup'),

  // Analytics
  analytics: (params?: { since?: string; until?: string }) => {
    const search = new URLSearchParams();
    if (params?.since) search.set('since', params.since);
    if (params?.until) search.set('until', params.until);
    return apiRequest<any>(`/api/analytics?${search}`);
  },
};