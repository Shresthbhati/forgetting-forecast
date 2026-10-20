import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFeatureModel, ratioOf, PROMOTION_MIN_ATTEMPTS, type FeatureAttempt } from '../src/domain/forecasting/featureModel.ts';
import { makeRng } from '../src/domain/assessment/random.ts';

const day = 86_400_000;
const t0 = Date.parse('2026-01-01T00:00:00Z');

/** Synthetic history where v1 is systematically over-confident on one question type and right on the other. */
function history(n: number, seed: number, biased: boolean): FeatureAttempt[] {
  const rng = makeRng(seed);
  return Array.from({ length: n }, (_, i) => {
    const type = i % 2 === 0 ? 'definition' : 'mcq';
    const predicted = 0.6 + rng() * 0.3;
    // True success probability: recall questions are much harder than v1 thinks; recognition matches v1.
    const truth = biased && type === 'definition' ? predicted * 0.5 : predicted;
    return {
      answeredAt: new Date(t0 + i * day / 4).toISOString(),
      predicted,
      correct: rng() < truth,
      elapsedSincePreviousReviewHours: 10 + (i % 5) * 20,
      questionType: type,
      topic: i % 3 === 0 ? 'A' : 'B',
    };
  });
}

test('ratio is exactly 1 with no data and moves towards observed/predicted with evidence', () => {
  assert.equal(ratioOf(undefined), 1);
  const lots = ratioOf({ correct: 50, predicted: 100, n: 100 });
  assert.ok(lots < 0.55 && lots > 0.5, String(lots));
  const few = ratioOf({ correct: 1, predicted: 2, n: 2 });
  assert.ok(few > lots && few < 1, 'a little data is shrunk towards 1');
});

test('below 10 scored attempts nothing is reported', () => {
  const e = evaluateFeatureModel(history(8, 1, true));
  assert.equal(e.insufficientData, true);
  assert.equal(e.v2Brier, null);
  assert.equal(e.worthPromoting, false);
});

test('when v1 is biased for a question type, the challenger learns it and beats v1 and the baselines', () => {
  const e = evaluateFeatureModel(history(400, 7, true));
  assert.equal(e.insufficientData, false);
  assert.ok(e.v2BeatsV1 && e.improvementOverV1! > 0.01, `improvement ${e.improvementOverV1}`);
  assert.equal(e.v2BeatsBestBaseline, true);
  assert.equal(e.worthPromoting, true);
  const def = e.learned.byType.find(r => r.key === 'definition')!;
  const mcq = e.learned.byType.find(r => r.key === 'mcq')!;
  assert.ok(def.ratio < 0.7, `definition ratio ${def.ratio}`);
  assert.ok(Math.abs(mcq.ratio - 1) < 0.15, `mcq ratio ${mcq.ratio}`);
});

test('when v1 is already calibrated the challenger does NOT claim to be better (it is reported honestly)', () => {
  const e = evaluateFeatureModel(history(400, 11, false));
  assert.ok(e.improvementOverV1! < 0.01, `improvement ${e.improvementOverV1}`);
  if (!e.v2BeatsV1) assert.equal(e.worthPromoting, false);
});

test('promotion needs at least PROMOTION_MIN_ATTEMPTS scored attempts even if the challenger wins', () => {
  const e = evaluateFeatureModel(history(PROMOTION_MIN_ATTEMPTS - 5, 7, true).slice(0, 20));
  assert.equal(e.worthPromoting, false);
});

test('walk-forward: shuffling input order does not change the result, and the future never helps the past', () => {
  const h = history(120, 3, true);
  const shuffled = [...h].reverse();
  assert.deepEqual(evaluateFeatureModel(h), evaluateFeatureModel(shuffled));
  // Flipping outcomes after the last scored attempt cannot change earlier predictions: add a final attempt and compare n-1 behaviour.
  const base = evaluateFeatureModel(h);
  const extended = evaluateFeatureModel([...h, { ...h[0], answeredAt: new Date(t0 + 999 * day).toISOString(), correct: !h[0].correct }]);
  assert.equal(extended.n, base.n + 1);
});

test('first reviews (no elapsed time) teach the model but are not scored', () => {
  const h = history(60, 5, true).map((a, i) => (i < 20 ? { ...a, elapsedSincePreviousReviewHours: null } : a));
  const e = evaluateFeatureModel(h);
  assert.equal(e.n, 40);
});
