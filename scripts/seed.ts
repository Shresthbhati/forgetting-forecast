/**
 * Demo account + realistic seed.
 *
 *   npm run db:seed          create (or reuse) the demo user; seed only if it has no concepts yet
 *   npm run db:reset-demo    wipe ONLY the demo user's data and re-seed it
 *
 * History is replayed through the real domain engine: at each simulated timestamp we call
 * calculateRecallProbability and updateRecallState with `now` set to that time and store exactly
 * what the app would store. Outcomes come from a hidden "true memory" (so the model is imperfect
 * and has to learn), drawn with a seeded RNG, so the same seed always produces the same history.
 * Forecasts are logged and evaluated with the same pure functions the server uses.
 *
 * NOTE: the history is SIMULATED. Calibration on this account demonstrates the pipeline, not that
 * the model predicts real human memory; the UI labels the account as sample data.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { SEED_CONCEPTS, createRng, type SeedConcept } from './seed-data.ts';
import {
  MODEL_VERSION,
  SCHEDULER_VERSION,
  calculateRecallProbability,
  confidenceFromLevel,
  generateForecast,
  initializeRecallState,
  updateRecallState,
} from '../src/domain/forecasting/engine.ts';
import { FORECAST_HORIZONS_HOURS, evaluateForecasts, type LoggedForecast } from '../src/domain/forecasting/evaluation.ts';
import { MIN_SAMPLES } from '../src/domain/analytics/calibration.ts';
import type { Concept, RecallState, RetrievalAttemptInput } from '../src/types/index.ts';

config({ path: '.env.local' });

export const DEMO_EMAIL = 'demo@forgetting-forecast.test';
const HOUR = 3_600_000;
const MAX_SPAN_DAYS = 44; // a concept's timeline (creation to last review) never exceeds this
const PROBE_BASE = new Date('2026-01-01T00:00:00Z'); // arbitrary epoch for the measuring pass

type SimAttempt = {
  id: string;
  at: Date;
  elapsedHours: number | null;
  predicted: number;
  correct: boolean;
  confidence: number;
  latencyMs: number;
};
type SimForecast = LoggedForecast & { sourceAttemptId: string; modelVersion: string; snapshot: RecallState };
type SimEvaluation = { forecastId: string; attemptId: string; observedCorrect: boolean; absError: number };
type SimConcept = {
  seed: SeedConcept;
  concept: Concept;
  state: RecallState;
  attempts: SimAttempt[];
  forecasts: SimForecast[];
  evaluations: SimEvaluation[];
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Simulates one concept's whole timeline starting at `base` (its creation time). Depends only on elapsed times. */
function simulateConcept(seed: SeedConcept, userId: string, base: Date, rng: () => number): SimConcept {
  const maxAttempts = 9 + Math.floor(rng() * 6); // 9-14 reviews: enough for intervals to grow past 72h
  const createdAt = base;
  const concept: Concept = {
    id: randomUUID(),
    userId,
    subject: seed.subject,
    topic: seed.topic,
    prompt: seed.prompt,
    answer: seed.answer,
    explanation: seed.explanation,
    difficulty: seed.difficulty,
    tags: seed.tags,
    sourceReference: null,
    archivedAt: null,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  };

  let t = new Date(createdAt.getTime() + (2 + rng() * 10) * HOUR);
  let state: RecallState = {
    ...initializeRecallState(concept),
    nextReviewAt: t.toISOString(),
    updatedAt: createdAt.toISOString(),
  };

  // Hidden "true memory" the model does not know: its own half-life in hours.
  let trueHalfLife = 14 + rng() * 30;
  const difficultyAdjustment = 1 - (seed.difficulty - 1) * 0.035;
  const attempts: SimAttempt[] = [];
  const forecasts: SimForecast[] = [];
  const evaluations: SimEvaluation[] = [];
  const pending: SimForecast[] = [];

  while (attempts.length < maxAttempts && t.getTime() - base.getTime() <= MAX_SPAN_DAYS * 24 * HOUR) {
    const lastAt = state.lastReviewedAt ? new Date(state.lastReviewedAt) : createdAt;
    const elapsedFromLast = (t.getTime() - lastAt.getTime()) / HOUR;

    const predicted = calculateRecallProbability(concept, state, t);
    const pTrue = clamp(0.5 ** (elapsedFromLast / trueHalfLife) * difficultyAdjustment, 0.02, 0.98);
    const correct = rng() < pTrue;

    // Confidence loosely tracks how sure the learner "feels" (the true probability plus noise).
    const level = clamp(Math.round(1 + 4 * pTrue + (rng() - 0.5) * 2), 1, 5);
    const latencyMs = Math.round(correct ? 2500 + rng() * 9000 : 7000 + rng() * 18000);

    const attemptInput: RetrievalAttemptInput = {
      conceptId: concept.id,
      sessionId: null,
      elapsedSincePreviousReviewHours: state.lastReviewedAt ? elapsedFromLast : null,
      predictedRecallProbability: predicted,
      actualCorrectness: correct,
      selfReportedConfidence: confidenceFromLevel(level),
      responseLatencyMs: latencyMs,
      reviewMode: 'due',
      modelVersion: MODEL_VERSION,
      schedulerVersion: SCHEDULER_VERSION,
      metadata: null,
    };
    const result = updateRecallState({ concept, recallState: state, attempt: attemptInput, now: t });
    state = result.recallState;

    const attempt: SimAttempt = {
      id: randomUUID(),
      at: t,
      elapsedHours: attemptInput.elapsedSincePreviousReviewHours,
      predicted,
      correct,
      confidence: confidenceFromLevel(level),
      latencyMs,
    };
    attempts.push(attempt);

    // Evaluate earlier forecasts, then log fresh ones: the same rules the server applies.
    for (const ev of evaluateForecasts(pending, { id: attempt.id, answeredAt: t.toISOString(), actualCorrectness: correct })) {
      evaluations.push(ev);
      pending.splice(pending.findIndex(f => f.id === ev.forecastId), 1);
    }
    for (const horizonHours of FORECAST_HORIZONS_HOURS) {
      const target = new Date(t.getTime() + horizonHours * HOUR);
      const forecast = generateForecast({ concept, recallState: state, at: target });
      const row: SimForecast = {
        id: randomUUID(),
        generatedAt: t.toISOString(),
        targetAt: target.toISOString(),
        horizonHours,
        predictedProbability: forecast.probability,
        sourceAttemptId: attempt.id,
        modelVersion: forecast.modelVersion,
        snapshot: state,
      };
      forecasts.push(row);
      pending.push(row);
    }

    // The true memory strengthens after a success and weakens after a lapse.
    trueHalfLife = correct
      ? Math.min(24 * 120, trueHalfLife * (1.5 + rng() * 0.8))
      : Math.max(2, trueHalfLife * (0.45 + rng() * 0.2));

    // The learner returns around the due time, usually a little late and sometimes much later.
    const due = new Date(state.nextReviewAt ?? t.toISOString());
    const interval = Math.max(0, due.getTime() - t.getTime());
    const lateMs = rng() * 0.6 * interval + (rng() < 0.15 ? rng() * 30 * HOUR : 0);
    t = new Date(Math.max(due.getTime(), t.getTime() + HOUR) + lateMs);
  }

  return { seed, concept, state, attempts, forecasts, evaluations };
}

type Plan = { sims: SimConcept[]; attempts: number; due: number; immediate: number; delayed: number; evaluated: number; atRisk7d: number; seed: number };

/**
 * Places a concept's timeline so its LAST review happened a random 0-1.5 review intervals before `now`.
 * (About a third of concepts therefore have an overdue next review, and none is stranded weeks in the past.)
 * Pass 1 measures the timeline at an arbitrary epoch; pass 2 replays the identical history (same RNG stream,
 * outcomes depend only on elapsed time) at the shifted start.
 */
function placeConcept(seed: SeedConcept, userId: string, now: Date, rngSeed: number): SimConcept {
  const probe = simulateConcept(seed, userId, PROBE_BASE, createRng(rngSeed));
  const last = probe.attempts[probe.attempts.length - 1].at.getTime();
  const interval = Math.max(HOUR, new Date(probe.state.nextReviewAt ?? last).getTime() - last);
  const lastAgo = createRng(rngSeed ^ 0x9e3779b9)() * 1.5 * interval;
  const base = new Date(now.getTime() - lastAgo - (last - PROBE_BASE.getTime()));
  return simulateConcept(seed, userId, base, createRng(rngSeed));
}

function buildPlan(userId: string, now: Date, rngSeed: number): Plan {
  const sims = SEED_CONCEPTS.map((c, i) => placeConcept(c, userId, now, rngSeed * 1000 + i));
  const allAttempts = sims.flatMap(s => s.attempts);
  return {
    sims,
    seed: rngSeed,
    attempts: allAttempts.length,
    due: sims.filter(s => s.state.nextReviewAt && new Date(s.state.nextReviewAt) <= now).length,
    immediate: allAttempts.filter(a => a.elapsedHours !== null && a.elapsedHours < 24).length,
    delayed: allAttempts.filter(a => a.elapsedHours !== null && a.elapsedHours >= 72).length,
    evaluated: sims.reduce((n, s) => n + s.evaluations.length, 0),
    atRisk7d: sims.filter(s => calculateRecallProbability(s.concept, s.state, new Date(now.getTime() + 168 * HOUR)) < 0.8).length,
  };
}

// Note: almost every concept is "at risk within 7 days" by design (reviews are scheduled for when recall hits the
// 80% target), so atRisk7d is reported but deliberately not constrained.
const meetsTargets = (p: Plan) =>
  p.attempts >= 100 && p.due >= 3 && p.due <= 8 &&
  p.immediate >= MIN_SAMPLES && p.delayed >= MIN_SAMPLES && p.evaluated >= MIN_SAMPLES;

/** Deterministic search for the first RNG seed whose history gives 3-8 due concepts and no "insufficient data" metrics. */
function choosePlan(userId: string, now: Date): Plan {
  let best: Plan | null = null;
  for (let seed = 1; seed <= 400; seed++) {
    const plan = buildPlan(userId, now, seed);
    if (meetsTargets(plan)) return plan;
    if (!best || Math.abs(plan.due - 5) < Math.abs(best.due - 5)) best = plan;
  }
  console.warn('No seed met every target; using the closest one.');
  return best!;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.DEMO_PASSWORD;
  if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  if (!password) throw new Error('Missing DEMO_PASSWORD in .env.local (see .env.example)');

  const reset = process.argv.includes('--reset');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ---- demo user: create or reuse, keep the password in sync ----
  let userId: string | null = null;
  for (let page = 1; !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find(u => u.email === DEMO_EMAIL)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (userId) {
    // Only touch the password when it actually differs: updating it signs every existing session out.
    const probe = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: probeError } = await probe.auth.signInWithPassword({ email: DEMO_EMAIL, password });
    if (probeError) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (error) throw error;
    }
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Demo Learner', timezone: 'UTC' },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  // The service role is trusted here; the trigger on profiles lets only the service role set is_demo.
  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: userId, display_name: 'Demo Learner', is_demo: true, daily_goal: 10 });
  if (profileError) throw profileError;

  // ---- reset or skip ----
  const { count } = await admin.from('concepts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (count && !reset) {
    console.log(`Demo account already seeded (${count} concepts). Run "npm run db:reset-demo" to rebuild it.`);
    return;
  }
  if (count) {
    // Only ever this user's rows. Concept deletion cascades to recall states, attempts and the forecast log.
    await admin.from('study_sessions').delete().eq('user_id', userId);
    const { error } = await admin.from('concepts').delete().eq('user_id', userId);
    if (error) throw error;
  }

  // ---- simulate + write ----
  const now = new Date();
  const plan = choosePlan(userId, now);

  const insert = async (table: string, rows: Record<string, unknown>[], chunk = 200) => {
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await admin.from(table).insert(rows.slice(i, i + chunk));
      if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
    }
  };

  await insert('concepts', plan.sims.map(({ concept: c, seed }) => ({
    id: c.id, user_id: userId, subject: c.subject, topic: c.topic, prompt: c.prompt, answer: c.answer,
    explanation: c.explanation, difficulty: c.difficulty, tags: seed.tags, source_reference: null,
    created_at: c.createdAt, updated_at: c.createdAt,
  })));

  await insert('recall_states', plan.sims.map(({ concept: c, state: s }) => ({
    concept_id: c.id, user_id: userId, model_version: s.modelVersion, initial_stability_days: s.initialStabilityDays,
    estimated_half_life_hours: s.estimatedHalfLifeHours, repetition_count: s.repetitionCount,
    successful_recall_count: s.successfulRecallCount, lapse_count: s.lapseCount, last_reviewed_at: s.lastReviewedAt,
    next_review_at: s.nextReviewAt, last_predicted_recall_probability: s.lastPredictedRecallProbability,
    updated_at: s.updatedAt,
  })));

  await insert('retrieval_attempts', plan.sims.flatMap(({ concept: c, attempts }) => attempts.map(a => ({
    id: a.id, user_id: userId, concept_id: c.id, session_id: null,
    presented_at: new Date(a.at.getTime() - a.latencyMs).toISOString(), answered_at: a.at.toISOString(),
    elapsed_since_previous_review_hours: a.elapsedHours, predicted_recall_probability: a.predicted,
    actual_correctness: a.correct, self_reported_confidence: a.confidence, response_latency_ms: a.latencyMs,
    model_version: MODEL_VERSION, scheduler_version: SCHEDULER_VERSION, review_mode: 'due',
    metadata: { demo: true }, client_request_id: randomUUID(),
  }))));

  await insert('forecast_log', plan.sims.flatMap(({ concept: c, forecasts }) => forecasts.map(f => ({
    id: f.id, user_id: userId, concept_id: c.id, generated_at: f.generatedAt, horizon_hours: f.horizonHours,
    target_at: f.targetAt, predicted_probability: f.predictedProbability, model_version: f.modelVersion,
    input_snapshot: f.snapshot, source_attempt_id: f.sourceAttemptId,
  }))));

  await insert('forecast_evaluations', plan.sims.flatMap(({ evaluations }) => evaluations.map(e => ({
    forecast_id: e.forecastId, user_id: userId, attempt_id: e.attemptId, observed_correct: e.observedCorrect,
    abs_error: e.absError,
  }))));

  console.log('Demo account ready.');
  console.log(`  user:        ${DEMO_EMAIL}`);
  console.log(`  rng seed:    ${plan.seed}`);
  console.log(`  concepts:    ${plan.sims.length}`);
  console.log(`  attempts:    ${plan.attempts}  (immediate ${plan.immediate}, delayed ${plan.delayed})`);
  console.log(`  forecasts:   ${plan.sims.reduce((n, s) => n + s.forecasts.length, 0)}  (evaluated ${plan.evaluated})`);
  console.log(`  due now:     ${plan.due}  (at risk within 7 days: ${plan.atRisk7d})`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
