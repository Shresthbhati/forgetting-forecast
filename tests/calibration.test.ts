import test from 'node:test';
import assert from 'node:assert/strict';
import { brierScore, calibrationBuckets } from '../src/domain/analytics/calibration.ts';

const outcomes = [
  { predictedRecallProbability: 0.9, actualCorrectness: true },  // (0.9-1)^2 = 0.01
  { predictedRecallProbability: 0.8, actualCorrectness: false }, // (0.8-0)^2 = 0.64
  { predictedRecallProbability: 0.2, actualCorrectness: false }, // (0.2-0)^2 = 0.04
  { predictedRecallProbability: 1.0, actualCorrectness: true },  // 0
];

test('brierScore is the mean squared prediction error', () => {
  assert.ok(Math.abs(brierScore(outcomes)! - (0.01 + 0.64 + 0.04 + 0) / 4) < 1e-12);
  assert.equal(brierScore([]), null);
});

test('calibrationBuckets groups by 0.1 bins and keeps p=1 in the top bin', () => {
  const buckets = calibrationBuckets(outcomes);
  assert.deepEqual(buckets.map(b => b.predictedRange[0]), [0.2, 0.8, 0.9]);
  const top = buckets[2];
  assert.equal(top.count, 2);
  assert.ok(Math.abs(top.predictedMean - 0.95) < 1e-12);
  assert.equal(top.observedAccuracy, 1);
});
