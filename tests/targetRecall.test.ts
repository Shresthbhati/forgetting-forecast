import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSchedulingPriority,
  generateForecast,
  generateHorizonForecasts,
  initializeRecallState,
  updateRecallState,
} from '../src/domain/forecasting/engine.ts';
import type { Concept, RetrievalAttemptInput } from '../src/types/index.ts';

const t0 = new Date('2026-01-01T00:00:00Z');
const concept: Concept = {
  id: 'c1', userId: 'u1', subject: 'DSA', topic: null, prompt: 'p', answer: 'a', explanation: null,
  difficulty: 3, tags: [], sourceReference: null, archivedAt: null,
  createdAt: t0.toISOString(), updatedAt: t0.toISOString(),
};
const correct: RetrievalAttemptInput = {
  conceptId: 'c1', sessionId: null, elapsedSincePreviousReviewHours: null, predictedRecallProbability: 0.7,
  actualCorrectness: true, selfReportedConfidence: 0.6, responseLatencyMs: 5000, reviewMode: 'due',
  modelVersion: 'exponential-half-life-v1', schedulerVersion: 'priority-queue-v1',
};
const nextReviewHours = (target?: number) => {
  const state = initializeRecallState(concept);
  const out = updateRecallState({ concept, recallState: state, attempt: correct, now: t0, targetRecall: target });
  return (new Date(out.nextReviewAt).getTime() - t0.getTime()) / 3_600_000;
};

test('a higher target recall schedules the next review sooner, a lower one later', () => {
  const low = nextReviewHours(0.6);
  const mid = nextReviewHours(0.8);
  const high = nextReviewHours(0.95);
  assert.ok(high < mid && mid < low, `${high} < ${mid} < ${low}`);
});

test('the default target is still 0.8 when none is given', () => {
  assert.equal(nextReviewHours(undefined), nextReviewHours(0.8));
});

test('the next review lands where predicted recall equals the target (after the early-repetition spacing)', () => {
  // With 1 repetition the engine halves the interval, so double it to compare with the pure model.
  const state = initializeRecallState(concept);
  for (const target of [0.6, 0.8, 0.9]) {
    const out = updateRecallState({ concept, recallState: state, attempt: correct, now: t0, targetRecall: target });
    const fullInterval = ((new Date(out.nextReviewAt).getTime() - t0.getTime()) / 3_600_000) * 2;
    const after = generateForecast({ concept, recallState: out.recallState, at: new Date(t0.getTime() + fullInterval * 3_600_000), targetRecall: target });
    assert.ok(Math.abs(after.probability - target) < 0.02, `target ${target}: predicted ${after.probability}`);
  }
});

test('forecast status labels follow the target', () => {
  const state = { ...initializeRecallState(concept), lastReviewedAt: t0.toISOString(), estimatedHalfLifeHours: 48 };
  const at = new Date(t0.getTime() + 20 * 3_600_000);
  assert.equal(generateForecast({ concept, recallState: state, at, targetRecall: 0.5 }).status, 'Strong');
  assert.equal(generateForecast({ concept, recallState: state, at, targetRecall: 0.95 }).status, 'Review soon');
});

test('dueInHours and scheduling priority use the target too', () => {
  const state = { ...initializeRecallState(concept), lastReviewedAt: t0.toISOString(), estimatedHalfLifeHours: 48 };
  const strict = generateForecast({ concept, recallState: state, at: t0, targetRecall: 0.95 });
  const relaxed = generateForecast({ concept, recallState: state, at: t0, targetRecall: 0.6 });
  assert.ok(strict.dueInHours < relaxed.dueInHours);
  const horizons = generateHorizonForecasts(concept, state, [24], t0, 0.5 as never);
  assert.equal(horizons[0].forecast.status, horizons[0].forecast.probability >= 0.5 ? 'Strong' : horizons[0].forecast.probability < 0.55 ? 'Due now' : 'Review soon');
  const p = calculateSchedulingPriority({ concept, recallState: { ...state, nextReviewAt: null }, now: t0, targetRecall: 0.95 as never });
  const q = calculateSchedulingPriority({ concept, recallState: { ...state, nextReviewAt: null }, now: t0, targetRecall: 0.6 as never });
  assert.ok(new Date(p.nextReviewAt) <= new Date(q.nextReviewAt));
});
