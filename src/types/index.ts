/**
 * Core domain types for Forgetting Forecast
 * These types are shared between frontend, backend, and domain logic
 * Using simple type aliases with validation functions for practicality
 */

import type { SourceKind, SourceLocation } from '../domain/ingestion/types.ts';
import type { Question } from '../domain/assessment/types.ts';
import type { TopicMastery } from '../domain/assessment/mastery.ts';

export type { SourceKind, SourceLocation };

export type UUID = string;
export type Timestamp = string;
export type Probability = number;
export type Confidence = number;
export type Difficulty = number;
export type LatencyMs = number;
export type HalfLifeHours = number;
export type ModelVersion = string;

export const CURRENT_MODEL_VERSION = 'exponential-half-life-v1';
export const CURRENT_SCHEDULER_VERSION = 'priority-queue-v1';

// Validation functions
export function isValidUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export function validateProbability(v: number): Probability {
  if (v < 0 || v > 1) throw new Error(`Probability must be in [0, 1], got ${v}`);
  return v;
}

export function validateConfidence(v: number): Confidence {
  if (v < 0 || v > 1) throw new Error(`Confidence must be in [0, 1], got ${v}`);
  return v;
}

export function validateDifficulty(v: number): Difficulty {
  if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`Difficulty must be integer 1-5, got ${v}`);
  return v;
}

export function validateLatencyMs(v: number): LatencyMs {
  if (v < 0) throw new Error(`Latency must be non-negative, got ${v}`);
  return v;
}

export function validateHalfLifeHours(v: number): HalfLifeHours {
  if (v < 0.5) throw new Error(`Half-life must be >= 0.5, got ${v}`);
  return v;
}

export function nowTimestamp(): Timestamp {
  return new Date().toISOString();
}

export interface Review {
  id: UUID;
  userId: UUID;
  conceptId: UUID;
  sessionId: UUID | null;
  presentedAt: Timestamp;
  answeredAt: Timestamp;
  elapsedSincePreviousReviewHours: number | null;
  predictedRecallProbability: Probability;
  actualCorrectness: boolean;
  selfReportedConfidence: Confidence | null;
  responseLatencyMs: LatencyMs;
  modelVersion: ModelVersion;
  schedulerVersion: ModelVersion;
  reviewMode: ReviewMode;
  metadata: Record<string, unknown> | null;
}

export type ReviewMode = 'due' | 'practice' | 'experiment';

export interface RetrievalAttemptInput {
  conceptId: UUID;
  sessionId: UUID | null;
  elapsedSincePreviousReviewHours: number | null;
  predictedRecallProbability: Probability;
  actualCorrectness: boolean;
  selfReportedConfidence: Confidence | null;
  responseLatencyMs: LatencyMs;
  reviewMode: ReviewMode;
  modelVersion: ModelVersion;
  schedulerVersion: ModelVersion;
  metadata?: Record<string, unknown> | null;
}

export interface Concept {
  id: UUID;
  userId: UUID;
  subject: string;
  topic: string | null;
  prompt: string;
  answer: string;
  explanation: string | null;
  difficulty: Difficulty;
  tags: string[];
  /** Free-text origin, e.g. "Database Notes, p. 12". Set for concepts made from an uploaded source. */
  sourceReference: string | null;
  /** Link back to the uploaded source/passage (null when typed by hand or the source was deleted). */
  sourceId?: UUID | null;
  sourceSectionId?: UUID | null;
  sourceLocation?: SourceLocation | null;
  archivedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RecallState {
  conceptId: UUID;
  userId: UUID;
  modelVersion: ModelVersion;
  initialStabilityDays: number;
  estimatedHalfLifeHours: HalfLifeHours;
  repetitionCount: number;
  successfulRecallCount: number;
  lapseCount: number;
  lastReviewedAt: Timestamp | null;
  nextReviewAt: Timestamp | null;
  lastPredictedRecallProbability: Probability | null;
  updatedAt: Timestamp;
}

export interface ForecastResult {
  probability: Probability;
  dueInHours: number;
  status: 'Strong' | 'Review soon' | 'Due now';
  evidence: string;
  modelVersion: ModelVersion;
  generatedAt: Timestamp;
}

export interface SchedulingResult {
  nextReviewAt: Timestamp;
  priorityScore: number;
  factors: SchedulingFactors;
}

export interface SchedulingFactors {
  estimatedRecallProbability: Probability;
  hoursSinceLastReview: number | null;
  isOverdue: boolean;
  uncertaintyLevel: 'low' | 'medium' | 'high';
  userPriority: number;
}

export interface ForecastInput {
  concept: Concept;
  recallState: RecallState;
  at: Date;
  targetRecall?: Probability;
}

export interface SchedulingInput {
  concept: Concept;
  recallState: RecallState;
  now: Date;
  userDailyCapacity?: number;
}

export interface ReviewOutcome {
  concept: Concept;
  recallState: RecallState;
  attempt: RetrievalAttemptInput;
  now: Date;
}

export interface UpdatedRecallState {
  recallState: RecallState;
  forecast: ForecastResult;
  nextReviewAt: Timestamp;
}

export interface DashboardSummary {
  totalActiveConcepts: number;
  dueConcepts: number;
  reviewsCompletedToday: number;
  reviewsCompletedThisWeek: number;
  meanEstimatedRecall: Probability;
  nextRecommendedReviews: ConceptWithForecast[];
  recentActivity: RecentActivityItem[];
}

export interface ConceptWithForecast {
  concept: Concept;
  forecast: ForecastResult;
  recallState: RecallState;
}

export interface RecentActivityItem {
  type: 'review' | 'concept_created' | 'concept_archived';
  conceptId: UUID;
  conceptTitle: string;
  timestamp: Timestamp;
  metadata?: Record<string, unknown>;
}

export interface ReviewQueueItem {
  concept: Concept;
  forecast: ForecastResult;
  recallState: RecallState;
  priorityScore: number;
}

export interface AnalyticsSummary {
  correctnessByTopic: TopicCorrectness[];
  correctnessByElapsedInterval: IntervalCorrectness[];
  reviewFrequency: ReviewFrequencyPoint[];
  lapseFrequency: LapseFrequencyPoint[];
  timePerRetrieval: TimePerRetrievalPoint[];
  forecastCalibration: CalibrationBucket[] | null;
  /** Mean squared prediction error over all attempts; lower is better, 0.25 = coin flip. */
  brierScore: number | null;
  modelComparison: ModelComparison | null;
  insufficientData: boolean;
  dataPoints: number;
  /** v2 fields (additive). Every metric is null + insufficientData below the minimum sample size. */
  immediateVsDelayed: {
    immediate: { n: number; accuracy: number | null };
    delayed: { n: number; accuracy: number | null };
    insufficientData: boolean;
  };
  calibration: {
    buckets: CalibrationBucket[];
    brierScore: number | null;
    n: number;
    insufficientData: boolean;
  };
  baseline: {
    n: number;
    modelBrier: number | null;
    historicalRateBrier: number | null;
    fixedHalfLifeBrier: number | null;
    bestBaseline: 'historical-rate' | 'fixed-half-life' | null;
    modelBeatsBaseline: boolean | null;
    brierImprovement: number | null;
    insufficientData: boolean;
  };
  forecastLog: {
    evaluated: number;
    pending: number;
    byHorizon: Array<{ horizonHours: number; evaluated: number; meanAbsError: number | null }>;
    insufficientData: boolean;
  };
}

export interface TopicCorrectness {
  topic: string;
  totalAttempts: number;
  correctAttempts: number;
  correctnessRate: number;
}

export interface IntervalCorrectness {
  intervalHours: number;
  totalAttempts: number;
  correctAttempts: number;
  correctnessRate: number;
}

export interface ReviewFrequencyPoint {
  date: string;
  count: number;
}

export interface LapseFrequencyPoint {
  date: string;
  count: number;
}

export interface TimePerRetrievalPoint {
  date: string;
  medianMs: number;
  meanMs: number;
}

export interface CalibrationBucket {
  predictedRange: [number, number];
  predictedMean: number;
  observedAccuracy: number;
  count: number;
}

export interface ModelComparison {
  baselineName: string;
  adaptiveName: string;
  baselineMetric: number;
  adaptiveMetric: number;
  metricName: string;
  pValue: number | null;
  sampleSize: number;
}

export interface ReviewQueueParams {
  mode?: ReviewMode;
  subject?: string;
  topic?: string;
  maxItems?: number;
  forecastHorizonHours?: number;
  page?: number;
  pageSize?: number;
}

export interface ForecastParams {
  horizonsHours?: number[];
}

export interface CreateConceptInput {
  subject: string;
  topic?: string | null;
  prompt: string;
  answer: string;
  explanation?: string | null;
  difficulty: Difficulty;
  tags?: string[];
  sourceReference?: string | null;
  sourceId?: UUID | null;
  sourceSectionId?: UUID | null;
  sourceLocation?: SourceLocation | null;
}

export interface UpdateConceptInput {
  subject?: string;
  topic?: string | null;
  prompt?: string;
  answer?: string;
  explanation?: string | null;
  difficulty?: Difficulty;
  tags?: string[];
  sourceReference?: string | null;
  archivedAt?: Timestamp | null;
}

// ---- Reviews, history and concept detail ----

export interface ReviewHistoryItem extends Review {
  conceptPrompt: string;
  conceptSubject: string;
}

export interface ReviewHistoryPage {
  items: ReviewHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConceptDetail {
  concept: Concept;
  recallState: RecallState;
  forecast: ForecastResult;
  horizonForecasts: Array<{ horizonHours: number; forecast: ForecastResult }>;
  attempts: Review[];
  /** Real output of the scheduling policy so the UI can show why a concept is prioritized. */
  priority: SchedulingResult;
}

// ---- Study sessions ----

export interface SessionSummary {
  total: number;
  correct: number;
  averageConfidence: number | null;
}

// ---- Forecast log ----

export type ForecastLogStatus = 'pending' | 'evaluated' | 'expired';

export interface ForecastLogEntry {
  id: UUID;
  conceptId: UUID;
  generatedAt: Timestamp;
  horizonHours: number;
  targetAt: Timestamp;
  predictedProbability: Probability;
  modelVersion: ModelVersion;
  status: ForecastLogStatus;
  evaluation: {
    attemptId: UUID;
    observedCorrect: boolean;
    absError: number;
    evaluatedAt: Timestamp;
  } | null;
}

// ---- Account ----

export interface Me {
  id: UUID;
  email: string | null;
  displayName: string | null;
  preferredTimezone: string;
  dailyGoal: number;
  targetRecall: number;
  isDemo: boolean;
}

// ---- Uploaded sources (docs/VISION_PLAN.md, phase 1) ----

export type SourceStatus = 'processing' | 'ready' | 'failed';

export interface Source {
  id: UUID;
  userId: UUID;
  subject: string;
  title: string;
  kind: SourceKind;
  storagePath: string;
  byteSize: number;
  sha256: string;
  status: SourceStatus;
  error: string | null;
  /** Pages or slides; 1 for Word and text files. */
  unitCount: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SourceSection {
  id: UUID;
  sourceId: UUID;
  ordinal: number;
  level: number;
  heading: string;
  text: string;
  location: SourceLocation;
  charCount: number;
}

export interface SourceTerm {
  id: UUID;
  sourceId: UUID;
  sectionId: UUID | null;
  term: string;
  definition: string | null;
  location: SourceLocation;
  score: number;
}

export interface SourceDetail {
  source: Source;
  sections: SourceSection[];
  terms: SourceTerm[];
  /** Terms that already have a concept made from them, so the UI can show "Added" after a reload. */
  addedTermIds: UUID[];
}

export interface UploadSourceResult {
  source: Source;
  /** True when this exact file was uploaded before and the existing source was returned. */
  duplicate: boolean;
}

export interface CreatedFromSource {
  created: Concept[];
  skipped: Array<{ termId?: UUID; sectionId?: UUID; reason: string }>;
}

// ---- Quizzes and mastery (phase 2) ----

export interface QuizResponse {
  section: { id: UUID; heading: string; location: SourceLocation };
  /** Generated by rules from the section's text. Every item carries its own "Generated from p. N" label. */
  questions: Question[];
  seed: number;
  /** Terms in this section with a definition but no concept yet: they are left out until the user adds them. */
  termsWithoutConcept: number;
  /** Their ids, so the UI can offer "add them and quiz me". */
  unaddedTermIds: UUID[];
  termsInSection: number;
}

export interface SourceMastery {
  topics: TopicMastery[];
}
