/**
 * Feature-adjusted challenger model (experimental, evaluation only).
 *
 * The production model ("exponential-half-life-v1") predicts recall from elapsed time, half-life and difficulty
 * alone. This challenger adds two features that are known at answer time: the QUESTION TYPE (recognising an option
 * is easier than producing a definition) and the TOPIC. For each feature value it learns a calibration ratio from the
 * user's EARLIER attempts:
 *
 *     ratio = (observed correct + k) / (sum of v1 predictions + k)        k = pseudo-count
 *
 * which is exactly 1 with no data and moves towards the real observed/predicted ratio as evidence arrives. The
 * challenger's prediction is  clamp(p_v1 * ratio_type * ratio_topic).
 *
 * It is only ever evaluated walk-forward (each attempt is predicted using strictly earlier attempts) and compared
 * with v1 and the two baselines on the SAME attempts. It is not used for scheduling unless it earns that.
 */

import { BASELINE_HALF_LIFE_HOURS, MIN_SAMPLES } from '../analytics/calibration.ts';

export const FEATURE_MODEL_VERSION = 'feature-adjusted-v2';
/** Virtual attempts that pull each ratio towards 1; larger = slower to trust a feature. */
export const PSEUDO_COUNT = 5;
/** Attempts needed before the challenger may be called better than v1 (a stricter bar than MIN_SAMPLES). */
export const PROMOTION_MIN_ATTEMPTS = 30;
const MIN_P = 0.01;
const MAX_P = 0.99;
const NO_TOPIC = '(no topic)';

export interface FeatureAttempt {
  answeredAt: string;
  /** The stored v1 prediction made before the outcome was known. */
  predicted: number;
  correct: boolean;
  elapsedSincePreviousReviewHours: number | null;
  /** From the attempt metadata (quiz / mixed test); null for ordinary reviews. */
  questionType: string | null;
  topic: string | null;
}

interface Tally {
  correct: number;
  predicted: number;
  n: number;
}

const clampP = (p: number) => Math.min(MAX_P, Math.max(MIN_P, p));
export const ratioOf = (t: Tally | undefined, k = PSEUDO_COUNT): number => (t ? (t.correct + k) / (t.predicted + k) : 1);

const keyType = (a: FeatureAttempt) => a.questionType ?? 'review';
const keyTopic = (a: FeatureAttempt) => a.topic?.trim() || NO_TOPIC;

class FeatureState {
  private byType = new Map<string, Tally>();
  private byTopic = new Map<string, Tally>();

  predict(p: number, type: string, topic: string): number {
    return clampP(p * ratioOf(this.byType.get(type)) * ratioOf(this.byTopic.get(topic)));
  }

  update(a: FeatureAttempt) {
    for (const [map, key] of [[this.byType, keyType(a)], [this.byTopic, keyTopic(a)]] as const) {
      const t = map.get(key) ?? { correct: 0, predicted: 0, n: 0 };
      t.correct += a.correct ? 1 : 0;
      t.predicted += a.predicted;
      t.n += 1;
      map.set(key, t);
    }
  }

  ratios() {
    const toRows = (map: Map<string, Tally>) =>
      [...map.entries()].map(([key, t]) => ({
        key, n: t.n, accuracy: t.correct / t.n, meanPredicted: t.predicted / t.n, ratio: ratioOf(t),
      }));
    return { byType: toRows(this.byType), byTopic: toRows(this.byTopic) };
  }
}

export interface FeatureModelEvaluation {
  /** Attempts evaluated: those with a known elapsed time, identical for every model compared. */
  n: number;
  v1Brier: number | null;
  v2Brier: number | null;
  historicalRateBrier: number | null;
  fixedHalfLifeBrier: number | null;
  /** v1 Brier minus v2 Brier; positive means the challenger is better. */
  improvementOverV1: number | null;
  v2BeatsV1: boolean | null;
  v2BeatsBestBaseline: boolean | null;
  /** True only with >= PROMOTION_MIN_ATTEMPTS attempts AND beating both v1 and the best baseline. */
  worthPromoting: boolean;
  insufficientData: boolean;
  /** What the challenger has learned, per question type and per topic (n >= 3 shown, ratio is shrunk towards 1). */
  learned: {
    byType: Array<{ key: string; n: number; accuracy: number; meanPredicted: number; ratio: number }>;
    byTopic: Array<{ key: string; n: number; accuracy: number; meanPredicted: number; ratio: number }>;
  };
}

/**
 * Walk-forward comparison of the challenger, v1 and the two baselines on the same attempts. Every attempt (including
 * first reviews) teaches the challenger afterwards; only attempts with an elapsed time are scored, as for the baselines.
 */
export function evaluateFeatureModel(attempts: FeatureAttempt[]): FeatureModelEvaluation {
  const ordered = [...attempts].sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  const state = new FeatureState();
  let priorCorrect = 0;
  let priorCount = 0;
  let n = 0;
  let v1 = 0, v2 = 0, hist = 0, fixed = 0;

  for (const a of ordered) {
    const y = a.correct ? 1 : 0;
    if (a.elapsedSincePreviousReviewHours !== null) {
      const p2 = state.predict(a.predicted, keyType(a), keyTopic(a));
      const h = (priorCorrect + 1) / (priorCount + 2);
      const f = clampP(0.5 ** (a.elapsedSincePreviousReviewHours / BASELINE_HALF_LIFE_HOURS));
      v1 += (a.predicted - y) ** 2;
      v2 += (p2 - y) ** 2;
      hist += (h - y) ** 2;
      fixed += (f - y) ** 2;
      n++;
    }
    state.update(a);
    priorCorrect += y;
    priorCount++;
  }

  const learned = state.ratios();
  const shown = {
    byType: learned.byType.filter(r => r.n >= 3).sort((a, b) => b.n - a.n),
    byTopic: learned.byTopic.filter(r => r.n >= 3).sort((a, b) => b.n - a.n),
  };

  if (n < MIN_SAMPLES) {
    return {
      n, v1Brier: null, v2Brier: null, historicalRateBrier: null, fixedHalfLifeBrier: null,
      improvementOverV1: null, v2BeatsV1: null, v2BeatsBestBaseline: null, worthPromoting: false,
      insufficientData: true, learned: shown,
    };
  }
  const [v1Brier, v2Brier, historicalRateBrier, fixedHalfLifeBrier] = [v1 / n, v2 / n, hist / n, fixed / n];
  const v2BeatsV1 = v2Brier < v1Brier;
  const v2BeatsBestBaseline = v2Brier < Math.min(historicalRateBrier, fixedHalfLifeBrier);
  return {
    n, v1Brier, v2Brier, historicalRateBrier, fixedHalfLifeBrier,
    improvementOverV1: v1Brier - v2Brier,
    v2BeatsV1, v2BeatsBestBaseline,
    worthPromoting: n >= PROMOTION_MIN_ATTEMPTS && v2BeatsV1 && v2BeatsBestBaseline,
    insufficientData: false,
    learned: shown,
  };
}
