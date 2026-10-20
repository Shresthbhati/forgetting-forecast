/**
 * Forecast calibration metrics - Domain layer
 * Pure functions comparing predicted recall probabilities with observed outcomes.
 */

import type { CalibrationBucket } from '@/types';

export type PredictionOutcome = {
  predictedRecallProbability: number;
  actualCorrectness: boolean;
};

/** Mean squared error between prediction and outcome (0 = perfect, 0.25 = always predicting 50%). */
export function brierScore(outcomes: PredictionOutcome[]): number | null {
  if (outcomes.length === 0) return null;
  const sum = outcomes.reduce((s, o) => s + (o.predictedRecallProbability - (o.actualCorrectness ? 1 : 0)) ** 2, 0);
  return sum / outcomes.length;
}

/** Reliability bins of width 0.1; a probability of exactly 1 falls in the top bin. */
export function calibrationBuckets(outcomes: PredictionOutcome[]): CalibrationBucket[] {
  const buckets = new Map<number, { predicted: number; correct: number; count: number }>();

  for (const o of outcomes) {
    const bin = Math.min(9, Math.floor(o.predictedRecallProbability * 10));
    const entry = buckets.get(bin) ?? { predicted: 0, correct: 0, count: 0 };
    entry.predicted += o.predictedRecallProbability;
    entry.correct += o.actualCorrectness ? 1 : 0;
    entry.count++;
    buckets.set(bin, entry);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([bin, v]) => ({
      predictedRange: [bin / 10, (bin + 1) / 10] as [number, number],
      predictedMean: v.predicted / v.count,
      observedAccuracy: v.correct / v.count,
      count: v.count,
    }));
}

/** Below this many observations a metric is reported as null with insufficientData: true. Never a made-up number. */
export const MIN_SAMPLES = 10;

export type TimedOutcome = PredictionOutcome & {
  answeredAt: string;
  elapsedSincePreviousReviewHours: number | null;
};

export type GroupAccuracy = { n: number; accuracy: number | null };

/** Accuracy when the previous review was under 24h ago ("immediate") versus 72h or more ago ("delayed"). */
export function immediateVsDelayed(attempts: TimedOutcome[]): {
  immediate: GroupAccuracy;
  delayed: GroupAccuracy;
  insufficientData: boolean;
} {
  const group = (pick: (hours: number) => boolean): GroupAccuracy => {
    const xs = attempts.filter(a => a.elapsedSincePreviousReviewHours !== null && pick(a.elapsedSincePreviousReviewHours));
    return {
      n: xs.length,
      accuracy: xs.length >= MIN_SAMPLES ? xs.filter(a => a.actualCorrectness).length / xs.length : null,
    };
  };
  const immediate = group(h => h < 24);
  const delayed = group(h => h >= 72);
  return { immediate, delayed, insufficientData: immediate.accuracy === null || delayed.accuracy === null };
}

export function calibrationSummary(attempts: PredictionOutcome[]): {
  buckets: CalibrationBucket[];
  brierScore: number | null;
  n: number;
  insufficientData: boolean;
} {
  if (attempts.length < MIN_SAMPLES) {
    return { buckets: [], brierScore: null, n: attempts.length, insufficientData: true };
  }
  return { buckets: calibrationBuckets(attempts), brierScore: brierScore(attempts), n: attempts.length, insufficientData: false };
}

/** The fixed half-life of the "no learning" baseline: the same 24h starting estimate every concept begins with. */
export const BASELINE_HALF_LIFE_HOURS = 24;

export type BaselineComparison = {
  /** Attempts used: those with a known elapsed time, identical for the model and both baselines. */
  n: number;
  modelBrier: number | null;
  historicalRateBrier: number | null;
  fixedHalfLifeBrier: number | null;
  bestBaseline: 'historical-rate' | 'fixed-half-life' | null;
  modelBeatsBaseline: boolean | null;
  /** Best baseline Brier minus model Brier; positive means the model is better. */
  brierImprovement: number | null;
  insufficientData: boolean;
};

/**
 * Compares the stored model predictions with two simple baselines on the SAME attempts:
 *  (a) historical-rate: predicts the user's correctness rate over strictly earlier attempts
 *      (Laplace-smoothed, so the first prediction is 0.5). No future data is ever used.
 *  (b) fixed-half-life: one global half-life for every concept, 0.5^(elapsed / 24h).
 * Attempts without an elapsed time (first reviews) are excluded from all three so the comparison is fair.
 */
export function compareWithBaselines(attempts: TimedOutcome[]): BaselineComparison {
  const ordered = [...attempts].sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  let priorCorrect = 0;
  let priorCount = 0;
  let model = 0;
  let historical = 0;
  let fixed = 0;
  let n = 0;

  for (const a of ordered) {
    const y = a.actualCorrectness ? 1 : 0;
    if (a.elapsedSincePreviousReviewHours !== null) {
      const hist = (priorCorrect + 1) / (priorCount + 2);
      const fix = Math.min(0.99, Math.max(0.01, 0.5 ** (a.elapsedSincePreviousReviewHours / BASELINE_HALF_LIFE_HOURS)));
      model += (a.predictedRecallProbability - y) ** 2;
      historical += (hist - y) ** 2;
      fixed += (fix - y) ** 2;
      n++;
    }
    priorCorrect += y;
    priorCount++;
  }

  if (n < MIN_SAMPLES) {
    return {
      n, modelBrier: null, historicalRateBrier: null, fixedHalfLifeBrier: null,
      bestBaseline: null, modelBeatsBaseline: null, brierImprovement: null, insufficientData: true,
    };
  }

  const modelBrier = model / n;
  const historicalRateBrier = historical / n;
  const fixedHalfLifeBrier = fixed / n;
  const bestBaseline = historicalRateBrier <= fixedHalfLifeBrier ? 'historical-rate' : 'fixed-half-life';
  const bestBaselineBrier = Math.min(historicalRateBrier, fixedHalfLifeBrier);
  return {
    n, modelBrier, historicalRateBrier, fixedHalfLifeBrier, bestBaseline,
    modelBeatsBaseline: modelBrier < bestBaselineBrier,
    brierImprovement: bestBaselineBrier - modelBrier,
    insufficientData: false,
  };
}
