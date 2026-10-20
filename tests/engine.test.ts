import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRecallProbability,
  confidenceFromLevel,
  generateHorizonForecasts,
  initializeRecallState,
  updateRecallState,
} from '../src/domain/forecasting/engine.ts';
import type { Concept, RetrievalAttemptInput } from '../src/types/index.ts';

const t0 = new Date('2026-01-01T00:00:00Z');
const hours = (h: number) => new Date(t0.getTime() + h * 3_600_000);

const concept: Concept = {
  id: 'c1', userId: 'u1', subject: 'DSA', topic: null, prompt: 'p', answer: 'a', explanation: null,
  difficulty: 3, tags: [], sourceReference: null, archivedAt: null,
  createdAt: t0.toISOString(), updatedAt: t0.toISOString(),
};

function attempt(correct: boolean, predicted: number, confidence: number | null = 0.6): RetrievalAttemptInput {
  return {
    conceptId: 'c1', sessionId: null, elapsedSincePreviousReviewHours: null, predictedRecallProbability: predicted,
    actualCorrectness: correct, selfReportedConfidence: confidence, responseLatencyMs: 5000, reviewMode: 'due',
    modelVersion: 'exponential-half-life-v1', schedulerVersion: 'priority-queue-v1',
  };
}

test('confidenceFromLevel is the single 1-5 -> 0-1 conversion and clamps out-of-range input', () => {
  assert.equal(confidenceFromLevel(1), 0.2);
  assert.equal(confidenceFromLevel(3), 0.6);
  assert.equal(confidenceFromLevel(5), 1);
  assert.equal(confidenceFromLevel(9), 1);
  assert.equal(confidenceFromLevel(0), 0.2);
});

test('first review: a never-reviewed concept uses its creation time and starts from the 24h prior', () => {
  const state = initializeRecallState(concept);
  assert.equal(state.repetitionCount, 0);
  assert.equal(state.lastReviewedAt, null);
  // exactly one half-life after creation, at difficulty 3 (adjustment 0.93): 0.5 * 0.93
  const p = calculateRecallProbability(concept, state, hours(24));
  assert.ok(Math.abs(p - 0.5 * 0.93) < 1e-9);
});

test('many lapses in a row never push the half-life below the 0.5h floor', () => {
  let state = initializeRecallState(concept);
  for (let i = 0; i < 40; i++) {
    state = updateRecallState({ concept, recallState: state, attempt: attempt(false, 0.5, 0.2), now: hours(i) }).recallState;
  }
  assert.equal(state.estimatedHalfLifeHours, 0.5);
  assert.equal(state.lapseCount, 40);
  assert.equal(state.successfulRecallCount, 0);
});

test('many successes cap the half-life at one year', () => {
  let state = initializeRecallState(concept);
  for (let i = 0; i < 60; i++) {
    state = updateRecallState({ concept, recallState: state, attempt: attempt(true, 0.9, 1), now: hours(i) }).recallState;
  }
  assert.ok(state.estimatedHalfLifeHours <= 24 * 365);
  assert.equal(state.estimatedHalfLifeHours, 24 * 365);
});

test('a very long gap drives the probability to its 0.01 floor, never to 0', () => {
  const state = initializeRecallState(concept);
  assert.equal(calculateRecallProbability(concept, state, hours(24 * 365 * 5)), 0.01);
});

test('horizon forecasts are anchored to the supplied now and fall as the horizon grows', () => {
  const state = initializeRecallState(concept);
  const result = generateHorizonForecasts(concept, state, [24, 168, 720], t0);
  const probs = result.map(r => r.forecast.probability);
  assert.deepEqual(result.map(r => r.horizonHours), [24, 168, 720]);
  // 168h and 720h both reach the 0.01 floor with a 24h half-life, so only non-increasing is guaranteed there.
  assert.ok(probs[0] > probs[1] && probs[1] >= probs[2]);
  assert.equal(result[0].forecast.generatedAt, hours(24).toISOString());
});
