import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_SAMPLES,
  calibrationSummary,
  compareWithBaselines,
  immediateVsDelayed,
  type TimedOutcome,
} from '../src/domain/analytics/calibration.ts';

const HOUR = 3_600_000;
const t0 = Date.parse('2026-01-01T00:00:00Z');

function attempt(i: number, elapsed: number | null, predicted: number, correct: boolean): TimedOutcome {
  return {
    answeredAt: new Date(t0 + i * HOUR).toISOString(),
    elapsedSincePreviousReviewHours: elapsed,
    predictedRecallProbability: predicted,
    actualCorrectness: correct,
  };
}

test('every metric is null + insufficientData below the minimum sample size', () => {
  const few = Array.from({ length: MIN_SAMPLES - 1 }, (_, i) => attempt(i, 5, 0.8, true));
  assert.equal(compareWithBaselines(few).insufficientData, true);
  assert.equal(compareWithBaselines(few).modelBrier, null);
  assert.equal(compareWithBaselines(few).modelBeatsBaseline, null);
  assert.equal(calibrationSummary(few).brierScore, null);
  assert.equal(calibrationSummary(few).insufficientData, true);
  assert.equal(immediateVsDelayed(few).immediate.accuracy, null);
});

test('baseline Brier scores match a hand computation on 10 attempts', () => {
  // 10 attempts, each 24h after the previous one, all correct, model always predicts 0.9.
  const xs = Array.from({ length: 10 }, (_, i) => attempt(i, 24, 0.9, true));
  const r = compareWithBaselines(xs);

  // model: (0.9 - 1)^2 = 0.01 for every attempt
  assert.ok(Math.abs(r.modelBrier! - 0.01) < 1e-12);

  // fixed half-life: p = 0.5^(24/24) = 0.5 -> (0.5 - 1)^2 = 0.25 for every attempt
  assert.ok(Math.abs(r.fixedHalfLifeBrier! - 0.25) < 1e-12);

  // historical rate, Laplace-smoothed over strictly earlier attempts: p_i = (i + 1) / (i + 2) for i = 0..9
  let expected = 0;
  for (let i = 0; i < 10; i++) expected += (1 - (i + 1) / (i + 2)) ** 2;
  assert.ok(Math.abs(r.historicalRateBrier! - expected / 10) < 1e-12);

  assert.equal(r.n, 10);
  assert.equal(r.modelBeatsBaseline, true);
  assert.ok(r.brierImprovement! > 0);
});

test('the historical-rate baseline never sees the attempt it predicts or any later one (no leakage)', () => {
  // Alternating outcomes: if the baseline peeked at the future it would score better than 0.25.
  const xs = Array.from({ length: 12 }, (_, i) => attempt(i, 10, 0.5, i % 2 === 0));
  const flipped = xs.map(x => ({ ...x, actualCorrectness: !x.actualCorrectness }));
  const a = compareWithBaselines(xs).historicalRateBrier!;
  const b = compareWithBaselines(flipped).historicalRateBrier!;
  // The first prediction is always the uninformed 0.5 regardless of the first outcome.
  assert.ok(a > 0.2 && b > 0.2);
});

test('attempts without an elapsed time (first reviews) are excluded from all three models', () => {
  const xs = [
    attempt(0, null, 0.99, false), // would hurt the model badly if it were counted
    ...Array.from({ length: 10 }, (_, i) => attempt(i + 1, 24, 0.9, true)),
  ];
  const r = compareWithBaselines(xs);
  assert.equal(r.n, 10);
  assert.ok(Math.abs(r.modelBrier! - 0.01) < 1e-12);
});

test('immediateVsDelayed splits at <24h and >=72h and reports n for each group', () => {
  const immediate = Array.from({ length: 10 }, (_, i) => attempt(i, 6, 0.9, i < 9)); // 9/10 correct
  const delayed = Array.from({ length: 10 }, (_, i) => attempt(i + 10, 100, 0.5, i < 5)); // 5/10 correct
  const middle = [attempt(30, 48, 0.7, true)]; // 24-72h is in neither group
  const r = immediateVsDelayed([...immediate, ...delayed, ...middle]);
  assert.deepEqual(r.immediate, { n: 10, accuracy: 0.9 });
  assert.deepEqual(r.delayed, { n: 10, accuracy: 0.5 });
  assert.equal(r.insufficientData, false);
});
