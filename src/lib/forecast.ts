/**
 * Client view of a concept plus display helpers.
 * All forecasting math lives in the domain engine; this module only adapts API payloads to it,
 * so the UI shows the same numbers the server stores and schedules with.
 */

import { generateForecast } from '@/domain/forecasting/engine';
import type { Concept as DomainConcept, RecallState } from '@/types';

export type Concept = {
  id: string;
  title: string;
  subject: string;
  topic?: string | null;
  prompt: string;
  answer: string;
  explanation: string;
  difficulty: number; // 1..5
  createdAt: string;
  recallState: RecallState | null;
  halfLifeHours: number;
  reviewCount: number;
};

/** Shape returned by GET /api/concepts and GET /api/concepts/:id. */
export type ApiConcept = {
  id: string;
  subject: string;
  topic: string | null;
  prompt: string;
  answer: string;
  explanation: string | null;
  difficulty: number;
  createdAt: string;
  recallState?: RecallState | null;
};

const DEFAULT_HALF_LIFE_HOURS = 24;

export function withRecallState(concept: Concept, recallState: RecallState | null): Concept {
  return {
    ...concept,
    recallState,
    halfLifeHours: recallState?.estimatedHalfLifeHours ?? DEFAULT_HALF_LIFE_HOURS,
    reviewCount: recallState?.repetitionCount ?? 0,
  };
}

export function fromApi(c: ApiConcept): Concept {
  return withRecallState({
    id: c.id,
    title: c.prompt.slice(0, 50) + (c.prompt.length > 50 ? '…' : ''),
    subject: c.subject,
    topic: c.topic,
    prompt: c.prompt,
    answer: c.answer,
    explanation: c.explanation || 'Review the answer and explain it in your own words.',
    difficulty: c.difficulty,
    createdAt: c.createdAt,
    recallState: null,
    halfLifeHours: DEFAULT_HALF_LIFE_HOURS,
    reviewCount: 0,
  }, c.recallState ?? null);
}

export function forecast(concept: Concept, at: Date = new Date(), targetRecall = 0.8) {
  const recallState = concept.recallState ?? ({
    estimatedHalfLifeHours: DEFAULT_HALF_LIFE_HOURS,
    repetitionCount: 0,
    successfulRecallCount: 0,
    lapseCount: 0,
    lastReviewedAt: null,
    nextReviewAt: null,
  } as unknown as RecallState);
  return generateForecast({
    concept: { difficulty: concept.difficulty, createdAt: concept.createdAt } as DomainConcept,
    recallState,
    at,
    targetRecall,
  });
}

export function hoursLabel(hours: number): string {
  if (hours <= 0.25) return 'now';
  if (hours < 24) return `in ${Math.round(hours)}h`;
  const days = hours / 24;
  return `in ${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
}
