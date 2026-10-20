import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateForecast,
  calculateRecallProbability,
  updateRecallState,
  initializeRecallState,
} from '../src/domain/forecasting/engine.ts';
import type {
  Concept,
  RecallState,
  RetrievalAttemptInput,
  ReviewOutcome,
  ModelVersion,
} from '../src/types';

const now = new Date('2026-10-11T00:00:00.000Z');
const baseConcept: Concept = {
  id: 'test' as any,
  userId: 'user1' as any,
  subject: 'Testing',
  topic: 'General',
  prompt: 'Question?',
  answer: 'Answer',
  explanation: 'Because.',
  difficulty: 3,
  tags: [],
  sourceReference: null,
  archivedAt: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

const baseRecallState: RecallState = {
  conceptId: 'test' as any,
  userId: 'user1' as any,
  modelVersion: 'exponential-half-life-v1',
  initialStabilityDays: 1.0,
  estimatedHalfLifeHours: 24,
  repetitionCount: 0,
  successfulRecallCount: 0,
  lapseCount: 0,
  lastReviewedAt: null,
  nextReviewAt: null,
  lastPredictedRecallProbability: null,
  updatedAt: now.toISOString(),
};

test('recall probability falls as time passes', () => {
  const later = new Date(now.getTime() + 48 * 3_600_000);
  assert.ok(
    calculateRecallProbability(baseConcept, baseRecallState, later) <
    calculateRecallProbability(baseConcept, baseRecallState, now)
  );
});

test('a correct review increases estimated half-life', () => {
  const attempt: RetrievalAttemptInput = {
    conceptId: 'test' as any,
    sessionId: null,
    elapsedSincePreviousReviewHours: 0,
    predictedRecallProbability: 0.8,
    actualCorrectness: true,
    selfReportedConfidence: 0.8,
    responseLatencyMs: 2500,
    reviewMode: 'due',
    modelVersion: 'exponential-half-life-v1',
    schedulerVersion: 'priority-queue-v1',
  };

  const outcome: ReviewOutcome = {
    concept: baseConcept,
    recallState: baseRecallState,
    attempt,
    now,
  };

  const result = updateRecallState(outcome);
  assert.ok(result.recallState.estimatedHalfLifeHours > baseRecallState.estimatedHalfLifeHours);
});

test('an incorrect review reduces estimated half-life', () => {
  const attempt: RetrievalAttemptInput = {
    conceptId: 'test' as any,
    sessionId: null,
    elapsedSincePreviousReviewHours: 0,
    predictedRecallProbability: 0.8,
    actualCorrectness: false,
    selfReportedConfidence: 0.9,
    responseLatencyMs: 9000,
    reviewMode: 'due',
    modelVersion: 'exponential-half-life-v1',
    schedulerVersion: 'priority-queue-v1',
  };

  const outcome: ReviewOutcome = {
    concept: baseConcept,
    recallState: baseRecallState,
    attempt,
    now,
  };

  const result = updateRecallState(outcome);
  assert.ok(result.recallState.estimatedHalfLifeHours < baseRecallState.estimatedHalfLifeHours);
});

test('forecast returns a valid probability and status', () => {
  const result = generateForecast({
    concept: baseConcept,
    recallState: baseRecallState,
    at: now,
  });
  assert.ok(result.probability > 0 && result.probability < 1);
  assert.ok(['Strong', 'Review soon', 'Due now'].includes(result.status));
});

test('a future forecast does not increase recall without a review', () => {
  const later = new Date(now.getTime() + 24 * 3_600_000);
  assert.ok(
    generateForecast({ concept: baseConcept, recallState: baseRecallState, at: later }).probability <
    generateForecast({ concept: baseConcept, recallState: baseRecallState, at: now }).probability
  );
});

test('initializeRecallState creates valid initial state', () => {
  const state = initializeRecallState(baseConcept, 24);
  assert.equal(state.estimatedHalfLifeHours, 24);
  assert.equal(state.repetitionCount, 0);
  assert.equal(state.modelVersion, 'exponential-half-life-v1');
});