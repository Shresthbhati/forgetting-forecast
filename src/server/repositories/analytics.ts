/**
 * Repository layer for analytics and dashboard data
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import { getUserRetrievalAttempts } from '@/server/repositories/retrievalAttempts';
import { getForecastEvaluationStats } from '@/server/repositories/forecasts';
import {
  MIN_SAMPLES,
  brierScore,
  calibrationBuckets,
  calibrationSummary,
  compareWithBaselines,
  immediateVsDelayed,
} from '@/domain/analytics/calibration';
import type {
  Review,
  DashboardSummary,
  ConceptWithForecast,
  ReviewQueueItem,
  AnalyticsSummary,
  TopicCorrectness,
  IntervalCorrectness,
  ReviewFrequencyPoint,
  LapseFrequencyPoint,
  TimePerRetrievalPoint,
  CalibrationBucket,
  ModelComparison,
  UUID,
  Probability,
  Timestamp,
} from '@/types';

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // The RPC reads auth.uid() itself and runs with the caller's permissions (migration 002).
  const { data, error } = await supabase.rpc('get_dashboard_summary');
  if (error) throw new Error(`Failed to get dashboard summary: ${error.message}`);

  const summary = data?.[0] ?? {
    total_active_concepts: 0,
    due_concepts: 0,
    reviews_completed_today: 0,
    reviews_completed_this_week: 0,
    mean_estimated_recall: 0,
  };

  // Get next recommended reviews
  const nextReviews = await getNextRecommendedReviews(5);

  return {
    totalActiveConcepts: Number(summary.total_active_concepts ?? 0),
    dueConcepts: Number(summary.due_concepts ?? 0),
    reviewsCompletedToday: Number(summary.reviews_completed_today ?? 0),
    reviewsCompletedThisWeek: Number(summary.reviews_completed_this_week ?? 0),
    meanEstimatedRecall: Number(summary.mean_estimated_recall ?? 0) as Probability,
    nextRecommendedReviews: nextReviews,
    recentActivity: [], // TODO: implement recent activity
  };
}

/** Top recommendations for the dashboard: the review queue in practice mode, which lists every concept most-urgent first. */
export async function getNextRecommendedReviews(limit: number): Promise<ConceptWithForecast[]> {
  const queue = await getReviewQueue('practice', undefined, limit);
  return queue.map(({ concept, forecast, recallState }) => ({ concept, forecast, recallState }));
}

export async function getReviewQueue(
  mode: 'due' | 'practice' | 'experiment' = 'due',
  subject?: string,
  maxItems = 20
): Promise<ReviewQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase.rpc('get_due_concepts', {
    p_limit: maxItems,
    p_mode: mode,
    p_subject: subject ?? null,
  });

  if (error) throw new Error(`Failed to get review queue: ${error.message}`);

  return (data ?? []).map((row: any) => {
    const now = new Date();
    const lastReview = row.last_reviewed_at ? new Date(row.last_reviewed_at) : new Date();
    const elapsed = row.last_reviewed_at
      ? Math.max(0, (now.getTime() - lastReview.getTime()) / 3_600_000)
      : 0;
    const halfLife = Math.max(0.5, row.estimated_half_life_hours);
    const raw = Math.pow(0.5, elapsed / halfLife);
    const difficultyAdjustment = 1 - (row.difficulty - 1) * 0.035;
    const probability = Math.min(0.99, Math.max(0.01, raw * difficultyAdjustment));
    const targetRecall = 0.8;
    const threshold = Math.min(0.99, Math.max(0.01, targetRecall / difficultyAdjustment));
    const hoursAtTarget = halfLife * Math.log(threshold) / Math.log(0.5);
    const dueInHours = Math.max(0, hoursAtTarget - elapsed);
    const status = probability < 0.55 ? 'Due now' : probability < targetRecall ? 'Review soon' : 'Strong';
    const evidence = !row.last_reviewed_at
      ? 'Initial estimate: no review history yet.'
      : `Last result: ${row.successful_recall_count > row.lapse_count ? 'correct' : 'incorrect'}`;

    // Priority score: lower recall probability = higher priority
    const priorityScore = 1 - probability;

    return {
      concept: {
        id: row.concept_id as UUID,
        userId: user.id as UUID,
        subject: row.subject,
        topic: row.topic,
        prompt: row.prompt,
        answer: row.answer,
        explanation: row.explanation,
        difficulty: row.difficulty as 1 | 2 | 3 | 4 | 5,
        tags: [],
        sourceReference: null,
        archivedAt: null,
        createdAt: row.created_at as Timestamp,
        updatedAt: row.created_at as Timestamp,
      },
      forecast: {
        probability: probability as Probability,
        dueInHours,
        status,
        evidence,
        modelVersion: 'exponential-half-life-v1' as any,
        generatedAt: now.toISOString() as Timestamp,
      },
      recallState: {
        conceptId: row.concept_id as UUID,
        userId: user.id as UUID,
        modelVersion: 'exponential-half-life-v1' as any,
        initialStabilityDays: 1.0,
        estimatedHalfLifeHours: row.estimated_half_life_hours as any,
        repetitionCount: row.repetition_count,
        successfulRecallCount: row.successful_recall_count,
        lapseCount: row.lapse_count,
        lastReviewedAt: row.last_reviewed_at as Timestamp | null,
        nextReviewAt: row.next_review_at as Timestamp | null,
        lastPredictedRecallProbability: row.last_predicted_recall_probability as Probability | null,
        updatedAt: now.toISOString() as Timestamp,
      },
      priorityScore,
    };
  });
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // ponytail: PostgREST returns at most 1000 rows; page this read if a user's history grows past that.
  const attempts = await getUserRetrievalAttempts(user.id as UUID);
  const v2 = await buildAnalyticsV2(attempts);
  if (attempts.length < MIN_SAMPLES) {
    return {
      correctnessByTopic: [],
      correctnessByElapsedInterval: [],
      reviewFrequency: [],
      lapseFrequency: [],
      timePerRetrieval: [],
      forecastCalibration: null,
      brierScore: null,
      modelComparison: null,
      insufficientData: true,
      dataPoints: attempts.length,
      ...v2,
    };
  }

  // Correctness by topic (via concept join)
  const { data: topicData } = await supabase
    .from('retrieval_attempts')
    .select(`
      actual_correctness,
      concepts!inner(subject)
    `)
    .eq('user_id', user.id);

  const topicMap = new Map<string, { total: number; correct: number }>();
  (topicData ?? []).forEach((row: any) => {
    const subject = (row.concepts as any)?.subject ?? 'Unknown';
    const entry = topicMap.get(subject) ?? { total: 0, correct: 0 };
    entry.total++;
    if (row.actual_correctness) entry.correct++;
    topicMap.set(subject, entry);
  });

  const correctnessByTopic: TopicCorrectness[] = Array.from(topicMap.entries()).map(([topic, v]) => ({
    topic,
    totalAttempts: v.total,
    correctAttempts: v.correct,
    correctnessRate: v.total > 0 ? v.correct / v.total : 0,
  }));

  // Correctness by elapsed interval (bucketed)
  const intervalMap = new Map<number, { total: number; correct: number }>();
  attempts.forEach(a => {
    const hours = a.elapsedSincePreviousReviewHours ?? 0;
    const bucket = Math.floor(hours / 24) * 24; // Daily buckets
    const entry = intervalMap.get(bucket) ?? { total: 0, correct: 0 };
    entry.total++;
    if (a.actualCorrectness) entry.correct++;
    intervalMap.set(bucket, entry);
  });

  const correctnessByElapsedInterval: IntervalCorrectness[] = Array.from(intervalMap.entries())
    .map(([intervalHours, v]) => ({
      intervalHours,
      totalAttempts: v.total,
      correctAttempts: v.correct,
      correctnessRate: v.total > 0 ? v.correct / v.total : 0,
    }))
    .sort((a, b) => a.intervalHours - b.intervalHours);

  // Review frequency (daily)
  const freqMap = new Map<string, number>();
  attempts.forEach(a => {
    const date = a.answeredAt.split('T')[0];
    freqMap.set(date, (freqMap.get(date) ?? 0) + 1);
  });

  const reviewFrequency: ReviewFrequencyPoint[] = Array.from(freqMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Lapse frequency (daily incorrect)
  const lapseMap = new Map<string, number>();
  attempts.filter(a => !a.actualCorrectness).forEach(a => {
    const date = a.answeredAt.split('T')[0];
    lapseMap.set(date, (lapseMap.get(date) ?? 0) + 1);
  });

  const lapseFrequency: LapseFrequencyPoint[] = Array.from(lapseMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Time per retrieval
  const timeMap = new Map<string, number[]>();
  attempts.forEach(a => {
    const date = a.answeredAt.split('T')[0];
    const arr = timeMap.get(date) ?? [];
    arr.push(a.responseLatencyMs);
    timeMap.set(date, arr);
  });

  const timePerRetrieval: TimePerRetrievalPoint[] = Array.from(timeMap.entries())
    .map(([date, latencies]) => ({
      date,
      medianMs: median(latencies),
      meanMs: latencies.reduce((s, v) => s + v, 0) / latencies.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Forecast calibration (if enough data)
  const calibration = attempts.length >= 50 ? calibrationBuckets(attempts) : null;

  return {
    correctnessByTopic,
    correctnessByElapsedInterval,
    reviewFrequency,
    lapseFrequency,
    timePerRetrieval,
    forecastCalibration: calibration,
    brierScore: brierScore(attempts),
    modelComparison: null,
    insufficientData: false,
    dataPoints: attempts.length,
    ...v2,
  };
}

/** The v2 analytics block: every metric is null + insufficientData when its sample is too small. */
async function buildAnalyticsV2(attempts: Review[]): Promise<
  Pick<AnalyticsSummary, 'immediateVsDelayed' | 'calibration' | 'baseline' | 'forecastLog'>
> {
  const timed = attempts.map(a => ({
    predictedRecallProbability: a.predictedRecallProbability,
    actualCorrectness: a.actualCorrectness,
    answeredAt: a.answeredAt,
    elapsedSincePreviousReviewHours: a.elapsedSincePreviousReviewHours,
  }));

  const stats = await getForecastEvaluationStats();
  return {
    immediateVsDelayed: immediateVsDelayed(timed),
    calibration: calibrationSummary(timed),
    baseline: compareWithBaselines(timed),
    forecastLog: {
      evaluated: stats.evaluated,
      pending: stats.unevaluated,
      byHorizon: stats.byHorizon.map(h => ({
        ...h,
        meanAbsError: h.evaluated >= MIN_SAMPLES ? h.meanAbsError : null,
      })),
      insufficientData: stats.evaluated < MIN_SAMPLES,
    },
  };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}