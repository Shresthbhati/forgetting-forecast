import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateForecasts,
  forecastStatus,
  isWithinEvaluationWindow,
  type LoggedForecast,
} from '../src/domain/forecasting/evaluation.ts';

const DAY = 24 * 3_600_000;
const t0 = Date.parse('2026-01-01T00:00:00Z');
const at = (days: number) => new Date(t0 + days * DAY).toISOString();

// A 7-day forecast made at t0 for t0 + 7d, predicting 70% recall.
const sevenDay: LoggedForecast = {
  id: 'f7',
  generatedAt: at(0),
  targetAt: at(7),
  horizonHours: 168,
  predictedProbability: 0.7,
};

test('a 7d forecast is evaluated only by an attempt between 3.5d and 10.5d after it was made', () => {
  assert.equal(isWithinEvaluationWindow(sevenDay, at(3.4)), false);
  assert.equal(isWithinEvaluationWindow(sevenDay, at(3.5)), true);
  assert.equal(isWithinEvaluationWindow(sevenDay, at(7)), true);
  assert.equal(isWithinEvaluationWindow(sevenDay, at(10.5)), true);
  assert.equal(isWithinEvaluationWindow(sevenDay, at(10.6)), false);
});

test('the attempt that generated a forecast never evaluates it', () => {
  assert.equal(isWithinEvaluationWindow(sevenDay, at(0)), false);
});

test('abs_error is |predicted - observed| for a correct and an incorrect outcome', () => {
  const [hit] = evaluateForecasts([sevenDay], { id: 'a1', answeredAt: at(7), actualCorrectness: true });
  assert.ok(Math.abs(hit.absError - 0.3) < 1e-12);
  assert.equal(hit.observedCorrect, true);

  const [miss] = evaluateForecasts([sevenDay], { id: 'a2', answeredAt: at(7), actualCorrectness: false });
  assert.ok(Math.abs(miss.absError - 0.7) < 1e-12);
});

test('one attempt can evaluate several horizons but never a forecast outside its window', () => {
  const oneDay: LoggedForecast = { id: 'f1', generatedAt: at(0), targetAt: at(1), horizonHours: 24, predictedProbability: 0.9 };
  const thirtyDay: LoggedForecast = { id: 'f30', generatedAt: at(0), targetAt: at(30), horizonHours: 720, predictedProbability: 0.4 };
  const results = evaluateForecasts([oneDay, sevenDay, thirtyDay], { id: 'a', answeredAt: at(1.2), actualCorrectness: true });
  // 1.2d is inside the 1d window (0.5d..1.5d) and nowhere near the 7d (3.5d+) or 30d (15d+) windows.
  assert.deepEqual(results.map(r => r.forecastId), ['f1']);
});

test('forecastStatus: pending until evaluated, expired once the window has closed', () => {
  assert.equal(forecastStatus(sevenDay, true, new Date(t0 + 20 * DAY)), 'evaluated');
  assert.equal(forecastStatus(sevenDay, false, new Date(t0 + 5 * DAY)), 'pending');
  assert.equal(forecastStatus(sevenDay, false, new Date(t0 + 10 * DAY)), 'pending');
  assert.equal(forecastStatus(sevenDay, false, new Date(t0 + 11 * DAY)), 'expired');
});
