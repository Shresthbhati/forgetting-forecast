/**
 * Forecasting engine - Domain layer
 * Pure functions for recall probability estimation and half-life updates
 * No dependencies on HTTP, database, or React
 */

import type {
  Concept,
  RecallState,
  ForecastResult,
  ForecastInput,
  SchedulingInput,
  SchedulingResult,
  SchedulingFactors,
  ReviewOutcome,
  UpdatedRecallState,
  RetrievalAttemptInput,
  Probability,
  HalfLifeHours,
  ModelVersion,
  Timestamp,
  Difficulty,
} from '@/types';

export const MODEL_VERSION = 'exponential-half-life-v1' as ModelVersion;
export const SCHEDULER_VERSION = 'priority-queue-v1' as ModelVersion;

/** Default target when the caller (a user setting) gives none. */
export const DEFAULT_TARGET_RECALL = 0.8 as Probability;
const TARGET_RECALL = DEFAULT_TARGET_RECALL;
const MIN_HALF_LIFE = 0.5 as HalfLifeHours;
const MAX_HALF_LIFE = 24 * 365 as HalfLifeHours; // 1 year
const MIN_PROBABILITY = 0.01 as Probability;
const MAX_PROBABILITY = 0.99 as Probability;

/**
 * The ONE place a 1-5 confidence rating becomes the 0-1 value stored in the database.
 * 1 -> 0.2 ... 5 -> 1.0 (so "not at all sure" is still a weak signal, never 0).
 */
export function confidenceFromLevel(level: number): number {
  return clamp(level, 1, 5) / 5;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
}

/**
 * Core recall probability calculation using exponential half-life model
 * P(recall at t) = 0.5 ^ (elapsed hours / estimated half-life hours)
 * With difficulty adjustment as prior
 */
export function calculateRecallProbability(
  concept: Concept,
  recallState: RecallState,
  at: Date = new Date()
): Probability {
  const lastReviewed = recallState.lastReviewedAt
    ? new Date(recallState.lastReviewedAt)
    : new Date(concept.createdAt);

  const elapsed = hoursBetween(lastReviewed, at);
  const halfLife = Math.max(MIN_HALF_LIFE, recallState.estimatedHalfLifeHours);
  const raw = Math.pow(0.5, elapsed / halfLife);

  // Difficulty adjustment: harder concepts start with lower baseline
  const difficultyAdjustment = 1 - (concept.difficulty - 1) * 0.035;

  return clamp(raw * difficultyAdjustment, MIN_PROBABILITY, MAX_PROBABILITY) as Probability;
}

/**
 * Generate a forecast for a concept at a specific time
 */
export function generateForecast(input: ForecastInput): ForecastResult {
  const { concept, recallState, at, targetRecall = TARGET_RECALL } = input;

  const probability = calculateRecallProbability(concept, recallState, at);

  const halfLife = Math.max(MIN_HALF_LIFE, recallState.estimatedHalfLifeHours);
  const difficultyAdjustment = 1 - (concept.difficulty - 1) * 0.035;
  const threshold = clamp(targetRecall / difficultyAdjustment, MIN_PROBABILITY, MAX_PROBABILITY);

  const lastReviewed = recallState.lastReviewedAt
    ? new Date(recallState.lastReviewedAt)
    : new Date(concept.createdAt);
  const elapsedHours = hoursBetween(lastReviewed, at);

  const hoursAtTarget = halfLife * Math.log(threshold) / Math.log(0.5);
  const dueInHours = Math.max(0, hoursAtTarget - elapsedHours);

  let status: ForecastResult['status'];
  if (probability < 0.55) status = 'Due now';
  else if (probability < targetRecall) status = 'Review soon';
  else status = 'Strong';

  const lastAttempt = recallState.repetitionCount > 0 ? 'recent' : 'none';
  const evidence = recallState.repetitionCount === 0
    ? 'Initial estimate: no review history yet.'
    : `Based on ${recallState.repetitionCount} reviews (${recallState.successfulRecallCount} correct, ${recallState.lapseCount} lapses). ` +
      `Current half-life estimate: ${halfLife.toFixed(1)} hours.`;

  return {
    probability,
    dueInHours,
    status,
    evidence,
    modelVersion: MODEL_VERSION,
    generatedAt: at.toISOString() as Timestamp,
  };
}

/**
 * Update recall state after a review attempt
 * This is the core learning algorithm
 */
export function updateRecallState(input: ReviewOutcome): UpdatedRecallState {
  const { concept, recallState, attempt, now } = input;
  const targetRecall = input.targetRecall ?? TARGET_RECALL;

  // Calculate the prediction BEFORE seeing the outcome (already done in attempt)
  const predictedProbability = attempt.predictedRecallProbability;

  // Update half-life based on outcome
  const latencySeconds = clamp(attempt.responseLatencyMs / 1000, 1, 120);
  const speedFactor = clamp(1.15 - Math.log2(latencySeconds + 1) / 8, 0.65, 1.1);

  const confidenceFactor = attempt.actualCorrectness
    ? 0.88 + (attempt.selfReportedConfidence ?? 0.5) * 0.32
    : 0.55 + (1 - (attempt.selfReportedConfidence ?? 0.5)) * 0.22;

  const outcomeFactor = attempt.actualCorrectness ? 1.55 : 0.42;
  const difficultyFactor = 1 - (concept.difficulty - 1) * 0.045;

  const updatedHalfLife = recallState.estimatedHalfLifeHours *
    outcomeFactor * speedFactor * confidenceFactor * difficultyFactor;

  const clampedHalfLife = clamp(updatedHalfLife, MIN_HALF_LIFE, MAX_HALF_LIFE) as HalfLifeHours;

  const nextRepetitionCount = recallState.repetitionCount + 1;
  const nextSuccessfulCount = recallState.successfulRecallCount + (attempt.actualCorrectness ? 1 : 0);
  const nextLapseCount = recallState.lapseCount + (attempt.actualCorrectness ? 0 : 1);

  const nextReviewAt = calculateNextReviewTime(
    concept,
    clampedHalfLife,
    now,
    nextRepetitionCount,
    targetRecall
  );

  const updatedState: RecallState = {
    ...recallState,
    estimatedHalfLifeHours: clampedHalfLife,
    repetitionCount: nextRepetitionCount,
    successfulRecallCount: nextSuccessfulCount,
    lapseCount: nextLapseCount,
    lastReviewedAt: now.toISOString() as Timestamp,
    nextReviewAt: nextReviewAt,
    lastPredictedRecallProbability: predictedProbability,
    updatedAt: now.toISOString() as Timestamp,
  };

  const forecast = generateForecast({
    concept,
    recallState: updatedState,
    at: now,
    targetRecall,
  });

  return {
    recallState: updatedState,
    forecast,
    nextReviewAt: nextReviewAt,
  };
}

/**
 * Calculate next review time based on current half-life and target recall
 */
function calculateNextReviewTime(
  concept: Concept,
  halfLife: HalfLifeHours,
  from: Date,
  repetitionCount: number,
  targetRecall: Probability = TARGET_RECALL
): Timestamp {
  const difficultyAdjustment = 1 - (concept.difficulty - 1) * 0.035;
  const threshold = clamp(targetRecall / difficultyAdjustment, MIN_PROBABILITY, MAX_PROBABILITY);
  const hoursAtTarget = halfLife * Math.log(threshold) / Math.log(0.5);

  // Add some spacing for early repetitions
  const spacingFactor = repetitionCount < 3 ? 0.5 : 1.0;
  const nextReviewHours = hoursAtTarget * spacingFactor;

  const nextReview = new Date(from.getTime() + nextReviewHours * 3_600_000);
  return nextReview.toISOString() as Timestamp;
}

/**
 * Scheduling policy: prioritize items for review queue
 */
export function calculateSchedulingPriority(input: SchedulingInput): SchedulingResult {
  const { concept, recallState, now } = input;
  const targetRecall = input.targetRecall ?? TARGET_RECALL;

  const forecast = generateForecast({
    concept,
    recallState,
    at: now,
    targetRecall,
  });

  const lastReviewed = recallState.lastReviewedAt
    ? new Date(recallState.lastReviewedAt)
    : new Date(concept.createdAt);
  const hoursSinceLastReview = hoursBetween(lastReviewed, now);

  const isOverdue = recallState.nextReviewAt
    ? new Date(recallState.nextReviewAt) <= now
    : false;

  // Uncertainty increases with fewer reviews and longer time since last review
  let uncertaintyLevel: SchedulingFactors['uncertaintyLevel'] = 'low';
  if (recallState.repetitionCount < 3) uncertaintyLevel = 'high';
  else if (recallState.repetitionCount < 10 || hoursSinceLastReview > recallState.estimatedHalfLifeHours * 2) {
    uncertaintyLevel = 'medium';
  }

  // Priority factors:
  // 1. Estimated recall probability (lower = higher priority)
  // 2. Overdue status (overdue = higher priority)
  // 3. Uncertainty (higher uncertainty = higher priority for exploration)
  const recallPriority = 1 - forecast.probability;
  const overduePriority = isOverdue ? 0.3 : 0;
  const uncertaintyPriority = uncertaintyLevel === 'high' ? 0.2 : uncertaintyLevel === 'medium' ? 0.1 : 0;

  const priorityScore = recallPriority + overduePriority + uncertaintyPriority;

  const factors: SchedulingFactors = {
    estimatedRecallProbability: forecast.probability,
    hoursSinceLastReview,
    isOverdue,
    uncertaintyLevel,
    userPriority: 0, // Could be extended for user-defined priorities
  };

  return {
    nextReviewAt: recallState.nextReviewAt ?? calculateNextReviewTime(concept, recallState.estimatedHalfLifeHours, now, recallState.repetitionCount, targetRecall),
    priorityScore,
    factors,
  };
}

/**
 * Generate forecasts for multiple time horizons
 */
export function generateHorizonForecasts(
  concept: Concept,
  recallState: RecallState,
  horizonsHours: number[],
  now: Date,
  targetRecall: Probability = TARGET_RECALL
): Array<{ horizonHours: number; forecast: ForecastResult }> {
  return horizonsHours.map(horizonHours => {
    const at = new Date(now.getTime() + horizonHours * 3_600_000);
    return {
      horizonHours,
      forecast: generateForecast({
        concept,
        recallState,
        at,
        targetRecall,
      }),
    };
  });
}

/**
 * Initialize recall state for a new concept
 */
export function initializeRecallState(
  concept: Concept,
  initialHalfLifeHours: HalfLifeHours = 24 as HalfLifeHours,
  targetRecall: Probability = TARGET_RECALL
): RecallState {
  const now = new Date().toISOString() as Timestamp;
  return {
    conceptId: concept.id,
    userId: concept.userId,
    modelVersion: MODEL_VERSION,
    initialStabilityDays: 1.0,
    estimatedHalfLifeHours: initialHalfLifeHours,
    repetitionCount: 0,
    successfulRecallCount: 0,
    lapseCount: 0,
    lastReviewedAt: null,
    nextReviewAt: calculateNextReviewTime(concept, initialHalfLifeHours, new Date(), 0, targetRecall),
    lastPredictedRecallProbability: null,
    updatedAt: now,
  };
}