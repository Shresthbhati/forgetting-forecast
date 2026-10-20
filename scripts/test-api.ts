/**
 * API smoke test: signs in as the demo user and exercises every route (status codes + response shapes),
 * including idempotent reviews, sessions, the forecast log, account endpoints, the open-redirect guard
 * and the write rate limit. Leaves no data behind except two finished study-session rows.
 *
 *   npm run dev            (in another terminal)
 *   API_BASE=http://localhost:3000 npm run test:api
 */

import { createServerClient } from '@supabase/ssr';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

config({ path: '.env.local' });

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const email = 'demo@forgetting-forecast.test';
const password = process.env.DEMO_PASSWORD;
if (!url || !anonKey || !password) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or DEMO_PASSWORD in .env.local');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

// ---- sign in and capture the auth cookies exactly as a browser would hold them ----
const jar = new Map<string, string>();
const supabase = createServerClient(url, anonKey, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: cookies => cookies.forEach(c => jar.set(c.name, c.value)),
  },
});
const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
if (signInError) {
  console.error(`Could not sign in as the demo user (${signInError.message}). Run "npm run db:seed" first.`);
  process.exit(1);
}
const cookieHeader = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

type Res = { status: number; json: any; headers: Headers };
async function call(method: string, path: string, body?: unknown, signedIn = true): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(signedIn ? { Cookie: cookieHeader } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, json, headers: res.headers };
}

console.log(`\nAPI smoke test against ${BASE}\n`);

// ---- health + auth ----
console.log('health and auth');
const health = await call('GET', '/api/health', undefined, false);
check('GET /api/health -> 200 healthy', health.status === 200 && health.json?.status === 'healthy', JSON.stringify(health.json));
for (const path of ['/api/concepts', '/api/dashboard', '/api/review-queue', '/api/analytics', '/api/reviews', '/api/me']) {
  const r = await call('GET', path, undefined, false);
  check(`signed-out GET ${path} -> 401 in the standard error shape`,
    r.status === 401 && r.json?.error?.code === 'UNAUTHORIZED' && typeof r.json?.error?.requestId === 'string', `${r.status}`);
}
const unauthPost = await call('POST', '/api/sessions', { mode: 'due' }, false);
check('signed-out POST /api/sessions -> 401', unauthPost.status === 401, `${unauthPost.status}`);

// ---- account ----
console.log('\naccount');
const me = await call('GET', '/api/me');
check('GET /api/me -> demo profile', me.status === 200 && me.json?.isDemo === true && me.json?.email === email, JSON.stringify(me.json));
const patched = await call('PATCH', '/api/me', { targetRecall: 0.85, dailyGoal: 12 });
check('PATCH /api/me updates settings', patched.status === 200 && patched.json?.targetRecall === 0.85 && patched.json?.dailyGoal === 12, JSON.stringify(patched.json));
await call('PATCH', '/api/me', { targetRecall: 0.8, dailyGoal: 10 });
check('PATCH /api/me rejects out-of-range values (400)', (await call('PATCH', '/api/me', { targetRecall: 2 })).status === 400);
check('PATCH /api/me cannot set isDemo (400)', (await call('PATCH', '/api/me', { isDemo: false })).status === 400);
check('DELETE /api/me without confirmation -> 400', (await call('DELETE', '/api/me', {})).status === 400);
const deleteDemo = await call('DELETE', '/api/me', { confirm: 'DELETE' });
check('DELETE /api/me on the demo account is refused (403)', deleteDemo.status === 403, `${deleteDemo.status}`);

// ---- reads on the seeded demo data ----
console.log('\nreads on seeded data');
const dash = await call('GET', '/api/dashboard');
check('GET /api/dashboard -> 15 concepts, 3-8 due',
  dash.status === 200 && dash.json?.totalActiveConcepts === 15 && dash.json.dueConcepts >= 3 && dash.json.dueConcepts <= 8, JSON.stringify(dash.json).slice(0, 200));
const queue = await call('GET', '/api/review-queue?maxItems=20');
check('GET /api/review-queue -> due items with forecast, recallState and priorityScore',
  queue.status === 200 && queue.json.items.length >= 3 && queue.json.items.every((i: any) => i.forecast && i.recallState && typeof i.priorityScore === 'number'), `${queue.json?.items?.length} items`);
const list = await call('GET', '/api/concepts?pageSize=50');
check('GET /api/concepts -> 15 concepts with recallState', list.status === 200 && list.json.concepts.length === 15 && list.json.concepts.every((c: any) => c.recallState));

const analytics = await call('GET', '/api/analytics');
const a = analytics.json;
check('GET /api/analytics -> no insufficientData and every v2 block present',
  analytics.status === 200 && a.insufficientData === false && a.calibration.insufficientData === false &&
  a.immediateVsDelayed.insufficientData === false && a.baseline.insufficientData === false && a.forecastLog.insufficientData === false,
  JSON.stringify({ n: a?.dataPoints, cal: a?.calibration?.n, base: a?.baseline?.n, evaluated: a?.forecastLog?.evaluated }));
check('analytics: calibration has buckets with n, and a Brier score', a.calibration.buckets.length > 0 && a.calibration.buckets.every((b: any) => b.count > 0) && typeof a.calibration.brierScore === 'number');
check('analytics: baseline comparison is a boolean with both baselines',
  typeof a.baseline.modelBeatsBaseline === 'boolean' && typeof a.baseline.historicalRateBrier === 'number' && typeof a.baseline.fixedHalfLifeBrier === 'number');
console.log(`        model Brier ${a.baseline.modelBrier?.toFixed(4)} vs historical-rate ${a.baseline.historicalRateBrier?.toFixed(4)} vs fixed-half-life ${a.baseline.fixedHalfLifeBrier?.toFixed(4)} (n=${a.baseline.n}); beats baseline: ${a.baseline.modelBeatsBaseline}`);
console.log(`        immediate ${(a.immediateVsDelayed.immediate.accuracy * 100).toFixed(0)}% (n=${a.immediateVsDelayed.immediate.n}) vs delayed ${(a.immediateVsDelayed.delayed.accuracy * 100).toFixed(0)}% (n=${a.immediateVsDelayed.delayed.n})`);
check('analytics: forecast log has evaluated entries with a mean absolute error per horizon',
  a.forecastLog.evaluated >= 10 && a.forecastLog.byHorizon.length > 0, JSON.stringify(a.forecastLog));

// ---- history ----
console.log('\nhistory');
const page1 = await call('GET', '/api/reviews?page=1&pageSize=10');
check('GET /api/reviews -> paginated, newest first, with concept text',
  page1.status === 200 && page1.json.items.length === 10 && page1.json.total >= 100 &&
  page1.json.items[0].answeredAt >= page1.json.items[9].answeredAt && typeof page1.json.items[0].conceptPrompt === 'string');
const wrong = await call('GET', '/api/reviews?result=incorrect&pageSize=100');
check('GET /api/reviews?result=incorrect -> only incorrect attempts', wrong.status === 200 && wrong.json.items.length > 0 && wrong.json.items.every((i: any) => i.actualCorrectness === false));
const firstConcept = list.json.concepts[0].id as string;
const forConcept = await call('GET', `/api/reviews?conceptId=${firstConcept}&pageSize=100`);
check('GET /api/reviews?conceptId= -> only that concept', forConcept.status === 200 && forConcept.json.items.every((i: any) => i.conceptId === firstConcept));
check('GET /api/reviews rejects pageSize > 100 (400)', (await call('GET', '/api/reviews?pageSize=101')).status === 400);
check('GET /api/reviews rejects a bad result filter (400)', (await call('GET', '/api/reviews?result=maybe')).status === 400);

// ---- concept detail + forecast log ----
console.log('\nconcept detail and forecast log');
const detail = await call('GET', `/api/concepts/${firstConcept}/detail`);
check('GET /api/concepts/:id/detail -> concept, state, 3 horizons, attempts and real priority factors',
  detail.status === 200 && detail.json.horizonForecasts.length === 3 && detail.json.attempts.length > 0 && detail.json.attempts.length <= 50 &&
  typeof detail.json.priority.priorityScore === 'number' && 'uncertaintyLevel' in detail.json.priority.factors, JSON.stringify(detail.json)?.slice(0, 160));
check('GET /api/concepts/:id/detail for an unknown id -> 404', (await call('GET', `/api/concepts/${randomUUID()}/detail`)).status === 404);
// Not every concept has an evaluated forecast (a fragile one reviewed hourly never has a later attempt inside a
// 1d/7d/30d window), so look for one that does.
let log = await call('GET', `/api/forecasts/${firstConcept}/log`);
for (const c of list.json.concepts) {
  const candidate = await call('GET', `/api/forecasts/${c.id}/log`);
  if ((candidate.json?.forecasts ?? []).some((f: any) => f.status === 'evaluated')) {
    log = candidate;
    break;
  }
}
const statuses = new Set((log.json?.forecasts ?? []).map((f: any) => f.status));
check('GET /api/forecasts/:id/log -> entries with status and evaluations', log.status === 200 && log.json.forecasts.length > 0 && statuses.has('evaluated'),
  `${[...statuses].join(',')}`);
check('forecast log: every evaluated entry carries abs_error', log.json.forecasts.filter((f: any) => f.status === 'evaluated').every((f: any) => f.evaluation && typeof f.evaluation.absError === 'number'));

// ---- review lifecycle on a throwaway concept ----
console.log('\nreview lifecycle (throwaway concept)');
const created = await call('POST', '/api/concepts', { subject: 'API-TEST', prompt: 'throwaway prompt', answer: 'throwaway answer', difficulty: 3 });
check('POST /api/concepts -> 201', created.status === 201 && typeof created.json?.id === 'string', `${created.status}`);
const conceptId = created.json.id as string;

const session = await call('POST', '/api/sessions', { mode: 'due' });
check('POST /api/sessions -> 201 with a sessionId', session.status === 201 && typeof session.json?.sessionId === 'string');
const sessionId = session.json.sessionId as string;
check('POST /api/sessions rejects a bad mode (400)', (await call('POST', '/api/sessions', { mode: 'nope' })).status === 400);

const clientRequestId = randomUUID();
const body = { conceptId, sessionId, clientRequestId, actualCorrectness: true, confidenceLevel: 4, responseLatencyMs: 4200, reviewMode: 'due' };
const first = await call('POST', '/api/reviews', body);
check('POST /api/reviews -> 201, duplicate false, server-computed prediction, confidence normalised to 0-1',
  first.status === 201 && first.json.duplicate === false && first.json.attempt.selfReportedConfidence === 0.8 &&
  typeof first.json.attempt.predictedRecallProbability === 'number' && first.json.updatedRecallState.repetitionCount === 1,
  JSON.stringify(first.json)?.slice(0, 200));
const second = await call('POST', '/api/reviews', body);
check('POST /api/reviews again with the same clientRequestId -> 200 duplicate: true, same attempt id',
  second.status === 200 && second.json.duplicate === true && second.json.attempt.id === first.json.attempt.id);
const afterDup = await call('GET', `/api/reviews?conceptId=${conceptId}`);
check('the duplicate wrote nothing: exactly one stored attempt', afterDup.json.total === 1, `total=${afterDup.json?.total}`);
const afterState = await call('GET', `/api/concepts/${conceptId}`);
check('the duplicate did not advance the recall state (repetitionCount stays 1)', afterState.json?.recallState?.repetitionCount === 1);

check('POST /api/reviews rejects latency over 30 minutes (400)', (await call('POST', '/api/reviews', { ...body, clientRequestId: randomUUID(), responseLatencyMs: 31 * 60 * 1000 })).status === 400);
check('POST /api/reviews rejects confidenceLevel 6 (400)', (await call('POST', '/api/reviews', { ...body, clientRequestId: randomUUID(), confidenceLevel: 6 })).status === 400);
check('POST /api/reviews with another user\'s / unknown sessionId -> 404', (await call('POST', '/api/reviews', { ...body, clientRequestId: randomUUID(), sessionId: randomUUID() })).status === 404);
check('POST /api/reviews for an unknown concept -> 404', (await call('POST', '/api/reviews', { ...body, clientRequestId: randomUUID(), conceptId: randomUUID() })).status === 404);
check('POST /api/reviews ignores a client-sent prediction (strict server-side value)',
  (await call('POST', '/api/reviews', { ...body, clientRequestId: randomUUID(), predictedRecallProbability: 0.01 })).json?.attempt?.predictedRecallProbability !== 0.01);

const logAfter = await call('GET', `/api/forecasts/${conceptId}/log`);
check('forecast log: each review writes 1d, 7d and 30d forecasts (pending)',
  logAfter.json.forecasts.length >= 3 && [24, 168, 720].every(h => logAfter.json.forecasts.some((f: any) => f.horizonHours === h && f.status === 'pending')));

const finished = await call('PATCH', `/api/sessions/${sessionId}`, { status: 'completed' });
check('PATCH /api/sessions/:id -> counts and summary computed server-side',
  finished.status === 200 && finished.json.status === 'completed' && finished.json.conceptCount === 1 && finished.json.summary?.total >= 1, JSON.stringify(finished.json));
check('PATCH /api/sessions/:id twice -> 409', (await call('PATCH', `/api/sessions/${sessionId}`, { status: 'completed' })).status === 409);
check('POST /api/reviews into a finished session -> 400', (await call('POST', '/api/reviews', { ...body, clientRequestId: randomUUID() })).status === 400);
check('PATCH /api/sessions/:id for an unknown id -> 404', (await call('PATCH', `/api/sessions/${randomUUID()}`, { status: 'completed' })).status === 404);

const del = await call('DELETE', `/api/concepts/${conceptId}`);
check('DELETE /api/concepts/:id -> 204', del.status === 204);
check('deleted concept -> 404', (await call('GET', `/api/concepts/${conceptId}`)).status === 404);

// ---- export ----
console.log('\nexport');
const exportRes = await fetch(`${BASE}/api/me/export`, { headers: { Cookie: cookieHeader } });
const exported: any = await exportRes.json();
check('GET /api/me/export -> attachment with every table',
  exportRes.status === 200 && (exportRes.headers.get('content-disposition') ?? '').includes('attachment') &&
  ['concepts', 'recall_states', 'retrieval_attempts', 'study_sessions', 'forecast_log', 'forecast_evaluations'].every(k => Array.isArray(exported[k])) &&
  exported.concepts.length === 15 && exported.retrieval_attempts.length >= 100,
  `concepts=${exported?.concepts?.length} attempts=${exported?.retrieval_attempts?.length}`);

// ---- redirects ----
console.log('\nredirects');
const evil = await fetch(`${BASE}/auth/callback?code=bogus&next=@evil.com`, { redirect: 'manual' });
const loc = evil.headers.get('location') ?? '';
check('auth callback with ?next=@evil.com never redirects off-site', evil.status >= 300 && evil.status < 400 && new URL(loc, BASE).origin === new URL(BASE).origin, loc);
const page = await fetch(`${BASE}/`, { redirect: 'manual' });
check('signed-out page request is redirected to /welcome by the middleware', page.status >= 300 && page.status < 400 && (page.headers.get('location') ?? '').includes('/welcome'), `${page.status} ${page.headers.get('location')}`);
const demo = await call('POST', '/api/demo-login', undefined, false);
check('POST /api/demo-login signs the demo account in server-side (password never sent to the client)',
  demo.status === 200 && demo.json?.ok === true && !JSON.stringify(demo.json).includes(password!), `${demo.status}`);

// ---- rate limit (last: it exhausts the review-write bucket for a minute) ----
console.log('\nrate limit');
let limited = 0;
for (let i = 0; i < 75; i++) {
  const r = await call('POST', '/api/reviews', {});
  if (r.status === 429) limited++;
}
check('a write flood on POST /api/reviews gets 429s', limited > 0, `${limited} of 75 limited`);
const flood = await call('POST', '/api/reviews', {});
check('429 uses the standard error shape', flood.status === 429 && flood.json?.error?.code === 'RATE_LIMITED' && typeof flood.json.error.requestId === 'string', `${flood.status}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
