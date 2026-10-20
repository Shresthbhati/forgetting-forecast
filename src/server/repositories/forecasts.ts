/**
 * Repository layer for the immutable forecast log and its evaluations.
 * forecast_log rows are insert-only (no UPDATE/DELETE policies); evaluations live in a separate table.
 */

import { createSupabaseServerClient } from '@/server/db/supabase';
import {
  forecastStatus,
  type ForecastEvaluationResult,
  type LoggedForecast,
} from '@/domain/forecasting/evaluation';
import type { ForecastLogEntry, ModelVersion, Probability, RecallState, Timestamp, UUID } from '@/types';

export interface NewForecastLog {
  conceptId: UUID;
  generatedAt: Timestamp;
  horizonHours: number;
  targetAt: Timestamp;
  predictedProbability: Probability;
  modelVersion: ModelVersion;
  inputSnapshot: RecallState;
  sourceAttemptId: UUID;
}

async function requireUserId(): Promise<{ supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; userId: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  return { supabase, userId: user.id };
}

export async function insertForecasts(rows: NewForecastLog[]): Promise<void> {
  if (rows.length === 0) return;
  const { supabase, userId } = await requireUserId();
  const { error } = await supabase.from('forecast_log').insert(
    rows.map(r => ({
      user_id: userId,
      concept_id: r.conceptId,
      generated_at: r.generatedAt,
      horizon_hours: r.horizonHours,
      target_at: r.targetAt,
      predicted_probability: r.predictedProbability,
      model_version: r.modelVersion,
      input_snapshot: r.inputSnapshot,
      source_attempt_id: r.sourceAttemptId,
    }))
  );
  if (error) throw new Error(`Failed to log forecasts: ${error.message}`);
}

export async function insertEvaluations(rows: ForecastEvaluationResult[]): Promise<void> {
  if (rows.length === 0) return;
  const { supabase, userId } = await requireUserId();
  // ignoreDuplicates: a forecast is evaluated at most once; a concurrent second evaluation is dropped.
  const { error } = await supabase.from('forecast_evaluations').upsert(
    rows.map(r => ({
      forecast_id: r.forecastId,
      user_id: userId,
      attempt_id: r.attemptId,
      observed_correct: r.observedCorrect,
      abs_error: r.absError,
    })),
    { onConflict: 'forecast_id', ignoreDuplicates: true }
  );
  if (error) throw new Error(`Failed to store forecast evaluations: ${error.message}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Forecasts for a concept that have not been evaluated yet. */
export async function getPendingForecasts(conceptId: UUID): Promise<LoggedForecast[]> {
  const { supabase, userId } = await requireUserId();
  const { data, error } = await supabase
    .from('forecast_log')
    .select('id, generated_at, target_at, horizon_hours, predicted_probability, forecast_evaluations(forecast_id)')
    .eq('user_id', userId)
    .eq('concept_id', conceptId);
  if (error) throw new Error(`Failed to read forecast log: ${error.message}`);

  return (data ?? [])
    .filter((row: any) => one(row.forecast_evaluations) === null)
    .map((row: any) => ({
      id: row.id,
      generatedAt: row.generated_at,
      targetAt: row.target_at,
      horizonHours: row.horizon_hours,
      predictedProbability: row.predicted_probability,
    }));
}

export async function listForecastLog(conceptId: UUID, now: Date): Promise<ForecastLogEntry[]> {
  const { supabase, userId } = await requireUserId();
  const { data, error } = await supabase
    .from('forecast_log')
    .select('*, forecast_evaluations(attempt_id, observed_correct, abs_error, evaluated_at)')
    .eq('user_id', userId)
    .eq('concept_id', conceptId)
    .order('generated_at', { ascending: false })
    .order('horizon_hours', { ascending: true });
  if (error) throw new Error(`Failed to read forecast log: ${error.message}`);

  return (data ?? []).map((row: any) => {
    const ev = one<any>(row.forecast_evaluations);
    const logged: LoggedForecast = {
      id: row.id,
      generatedAt: row.generated_at,
      targetAt: row.target_at,
      horizonHours: row.horizon_hours,
      predictedProbability: row.predicted_probability,
    };
    return {
      id: row.id as UUID,
      conceptId: row.concept_id as UUID,
      generatedAt: row.generated_at as Timestamp,
      horizonHours: row.horizon_hours,
      targetAt: row.target_at as Timestamp,
      predictedProbability: row.predicted_probability as Probability,
      modelVersion: row.model_version as ModelVersion,
      status: forecastStatus(logged, ev !== null, now),
      evaluation: ev
        ? {
            attemptId: ev.attempt_id as UUID,
            observedCorrect: ev.observed_correct,
            absError: ev.abs_error,
            evaluatedAt: ev.evaluated_at as Timestamp,
          }
        : null,
    };
  });
}

/** Evaluated count and mean absolute error per horizon, plus how many logged forecasts are still unevaluated. */
export async function getForecastEvaluationStats(): Promise<{
  evaluated: number;
  unevaluated: number;
  byHorizon: Array<{ horizonHours: number; evaluated: number; meanAbsError: number | null }>;
}> {
  const { supabase, userId } = await requireUserId();

  const [{ data, error }, { count: logged, error: countError }] = await Promise.all([
    // ponytail: PostgREST caps a response at 1000 rows; page this query if a user accumulates more evaluations.
    supabase.from('forecast_evaluations').select('abs_error, forecast_log!inner(horizon_hours)').eq('user_id', userId),
    supabase.from('forecast_log').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);
  if (error) throw new Error(`Failed to read forecast evaluations: ${error.message}`);
  if (countError) throw new Error(`Failed to count forecasts: ${countError.message}`);

  const groups = new Map<number, { sum: number; n: number }>();
  for (const row of data ?? []) {
    const horizon = (one<any>((row as any).forecast_log))?.horizon_hours;
    if (typeof horizon !== 'number') continue;
    const g = groups.get(horizon) ?? { sum: 0, n: 0 };
    g.sum += (row as any).abs_error;
    g.n++;
    groups.set(horizon, g);
  }

  const evaluated = data?.length ?? 0;
  return {
    evaluated,
    unevaluated: Math.max(0, (logged ?? 0) - evaluated),
    byHorizon: [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([horizonHours, g]) => ({ horizonHours, evaluated: g.n, meanAbsError: g.n > 0 ? g.sum / g.n : null })),
  };
}
