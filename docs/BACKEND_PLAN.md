# Forgetting Forecast — Backend Completion Plan

Companion to `docs/REDESIGN_PLAN.md`. The UI plan never touches `src/server/**`, `src/app/api/**`, `src/domain/**` or `supabase/**`. This plan owns them.
Give each coding agent the **Agent preamble** plus one task.

---

## 0. Where the backend actually stands (verified 2026-10-20 by reading the code)

**Works:**
- 5 tables: `profiles`, `concepts`, `recall_states`, `retrieval_attempts` (append-only), `study_sessions`. RLS is on, with own-row policies.
- API routes:

  | Route | Methods |
  |---|---|
  | `/api/concepts` | GET, POST |
  | `/api/concepts/[id]` | GET, PATCH, DELETE |
  | `/api/reviews` | POST |
  | `/api/review-queue` | GET |
  | `/api/forecasts/[conceptId]` | GET |
  | `/api/dashboard` | GET |
  | `/api/analytics` | GET |
  | `/api/health` | GET |

- Layers: route → service (`src/server/services`) → repository (`src/server/repositories`), plus a pure domain engine (`src/domain/forecasting/engine.ts`, half-life model) and calibration helpers (`src/domain/analytics/calibration.ts`).
- Zod validation, and an error mapper that turns errors into 401/403/404 responses.
- `submitReview` computes the prediction on the server **before** it sees the outcome and stores it on the attempt. That is already a sound calibration dataset.

**Broken or missing, in priority order:**

| # | Problem | Where | Severity |
|---|---|---|---|
| 1 | **Cross-user data leak.** `get_due_concepts(p_user_id)` and `get_dashboard_summary(p_user_id)` are `SECURITY DEFINER`, so they bypass RLS, and they trust a caller-supplied `p_user_id`. Postgres lets PUBLIC execute functions by default, so anyone holding the public anon key can call `supabase.rpc('get_due_concepts', { p_user_id: <victim> })` and read another user's concepts and answers. | `supabase/migrations/001_initial_schema.sql` (lines ~162–253) | 🔴 Critical |
| 2 | **Open redirect.** `NextResponse.redirect(\`${origin}${next}\`)` with `next` taken from the query string. `?next=@evil.com` produces `http://host@evil.com`, which sends the user to evil.com. | `src/app/auth/callback/route.ts` | 🔴 High |
| 3 | **No middleware.** Nothing refreshes Supabase session cookies, so sessions silently expire and API routes start returning 401. The routes also have no server-side protection. | (missing `src/middleware.ts`) | 🟠 High |
| 4 | **Review writes aren't atomic or idempotent.** The attempt insert and the recall-state update are two separate writes, and a retried request inserts a duplicate attempt, which corrupts the calibration data. | `src/server/services/reviews.ts` | 🟠 High |
| 5 | **No history endpoint.** `getReviewHistory()` returns `[]`, and the History page calls `/api/analytics` instead. | `services/reviews.ts`, `app/history/page.tsx` | 🟠 High |
| 6 | **No sessions API.** The repository functions exist (`createSession`, `completeSession`, `abandonSession`), but no route uses them. | `repositories/studySessions.ts` | 🟡 Medium |
| 7 | **Horizon forecasts are never logged.** They're shown but never saved, so the "forecast vs what happened" promise can't be audited. | (missing) | 🟡 Medium (it's the pitch) |
| 8 | **Analytics are thin.** No immediate-vs-delayed comparison, no comparison against a simpler baseline model, and no sample sizes on the numbers. | `repositories/analytics.ts` | 🟡 Medium |
| 9 | **No account endpoints.** Settings, export and account deletion don't exist on the backend. | (missing) | 🟡 Medium |
| 10 | **Weak seed and no demo account.** The seed has 4 concepts and no history. | `scripts/seed.ts` | 🟡 Medium (needed for the demo) |
| 11 | **Only 2 test files**, covering the domain engine and calibration. There are no RLS, API or integration tests. | `tests/` | 🟡 Medium |
| 12 | **Repeated request plumbing.** Every route repeats the `requestId` / try / catch boilerplate, even though `createApiHandler()` already exists in `src/server/errors`. | `src/app/api/**` | ⚪ Low |

Docs to distrust: `docs/FEATURE_STATUS.md` and `docs/PRODUCT_AUDIT.md` are partly stale (both say the History, Settings and Concept detail pages are missing, but they exist). This section is the current truth.

---

## 1. Guardrails for every backend task

- **Migrations are additive and numbered up front** so parallel agents never collide:
  - `002_secure_rpcs.sql` (B1)
  - `003_atomic_review.sql` (B2)
  - `004_forecast_log.sql` (B5)
  - `005_profile_settings.sql` (B7)

  Never edit `001`. Each migration must be safe to re-run (`IF NOT EXISTS`, `CREATE OR REPLACE`). Apply them with the Supabase SQL editor or `supabase db push`, and say which one you used.
- Every `SECURITY DEFINER` function must use `auth.uid()` (never a user-id parameter), set `SET search_path = public`, and have `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO authenticated`. Prefer `SECURITY INVOKER` so RLS still applies.
- The service-role key is used **only** in server files (`src/server/**`, `scripts/**`) and never in anything imported by a `'use client'` file. Check with `grep -rn SERVICE_ROLE src` before finishing.
- Keep the layering: route (parse, validate, respond) → service (auth + orchestration) → repository (SQL) → domain (pure maths). Routes use `createApiHandler()`.
- **API contract changes are additive only.** Existing response fields keep their names and types, because the UI agents depend on them. New client methods go into `src/lib/api.ts` and new types into `src/types/index.ts`.
- `src/domain/**` stays pure: no I/O and no `Date.now()` inside functions (pass `now` in).
- Every task ends with `npm run typecheck && npm run lint && npm test && npm run build`, plus a real request against the dev server (with a curl or fetch transcript) for every new or changed endpoint. If no Supabase project is reachable, report it as **not verified**. Never claim a pass you didn't see.

## Agent preamble (paste before every task)

> You are working in `forgetting-forecast/` (Next.js 15 App Router, TypeScript, Supabase/Postgres with RLS).
> Read `docs/BACKEND_PLAN.md` sections 0 and 1 first; they are binding. Only edit the files your task lists. Keep API changes
> additive. Before finishing, run `npm run typecheck && npm run lint && npm test && npm run build`, call every endpoint you
> touched against the running dev server, and report exactly what you ran and observed. If something could not be verified,
> say "not verified".

---

## 2. Task graph

```
B0 Baseline ─┬─► B1 Security (RPCs, redirect, middleware) ─┬─► B2 Atomic+idempotent reviews ─► B3 Sessions API ─► B5 Forecast log
             │                                             ├─► B4 History + concept detail API
             │                                             ├─► B6 Analytics v2 (after B4)
             │                                             └─► B7 Account: settings/export/delete
             └─► B8 Demo account + seed (needs B2 for replay) ──────────────────────────────┐
                                                           B9 Tests (grows with each task) ─┴─► B10 Hardening + docs (last)
```

- `reviews.ts` is edited by B2, then B3, then B5, **in that order and never in parallel**.
- Parallel after B1: B2, B4, B7. B6 starts after B4 (it reuses the history query). B8 starts after B2.
- **Hackathon cut line:** B0, B1, B2, B4 and B8 are required (security plus a demo with real data). B6 is strongly recommended (it's the "we beat the baseline" slide). B3, B5, B7, B9 and B10 come after that.

### How this plan lines up with the UI plan

| UI task | Needs backend task |
|---|---|
| T2 shell "SAMPLE DATA" pill | B8 (`profiles.is_demo`) + B7 (`GET /api/me`) |
| T6 review workspace | B2 (idempotency key), B3 (session ids) |
| T7 concept detail | B4 (`/api/concepts/[id]/detail`), B5 (forecast log) |
| T8 analytics / history | B4 (`/api/reviews` list), B6 |
| T9 settings | B7 |
| T10 demo data | **Replaced by B8.** Run only B8. |

---

## B0 — Baseline and environment check  *(first; about 30 min; no code changes)*

1. Confirm `.env.local` points at a reachable Supabase project, and that `001_initial_schema.sql` has been applied (all 5 tables and 2 functions exist; use the Supabase MCP `list_tables` or the SQL editor).
2. Run `npm i`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and record the results.
3. `npm run dev`, then call `GET /api/health` (expect 200) and `GET /api/concepts` signed out (expect 401).
4. **Reproduce the leak (#1):** with two test users A and B, sign in as A in a browser console and call `supabase.rpc('get_due_concepts', { p_user_id: '<B's id>' })`. Record whether B's rows come back. This is the regression test for B1.
5. Write the results to `docs/BACKEND_BASELINE.md`.

**Done when:** there is a baseline record and the leak is either confirmed or ruled out with evidence.

---

## B1 — Security fixes  *(critical; blocks everything public)*

**Files:** new `supabase/migrations/002_secure_rpcs.sql`, `src/server/repositories/analytics.ts` (the RPC call sites only), `src/app/auth/callback/route.ts`, new `src/middleware.ts`.

1. **RPCs.** `CREATE OR REPLACE` both functions **without** the `p_user_id` parameter (drop the old signatures first: `DROP FUNCTION IF EXISTS public.get_due_concepts(uuid, ...)` with the exact old signature from 001), read `auth.uid()` inside, use `SECURITY INVOKER` and `SET search_path = public`, then `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`. Update the two `supabase.rpc(...)` calls so they no longer pass `p_user_id`.
2. **Callback.** Accept `next` only if it starts with `/` and not with `//` or `/\`; otherwise use `/`. Build the redirect URL with `new URL(next, origin)` and check that `.origin === origin`.
3. **Middleware.** Add the standard `@supabase/ssr` `updateSession` middleware (refresh cookies on every request). Exclude `_next/static`, `_next/image`, the favicon, static assets and `/api/health`. For unauthenticated `/api/*` requests, let the route return its own 401; don't redirect API calls. For pages, the UI plan's `/welcome` is the redirect target. Until T4 exists, use `/auth/signin`.
4. Re-run the B0 step 4 repro. It must now return 0 rows or a permission error.

**Done when:** the leak repro fails, `?next=@evil.com` lands on `/`, a session survives past access-token expiry (or token refresh can be seen in the network tab), and dashboard and queue still return the user's own data.

---

## B2 — Atomic, idempotent review submission

**Files:** new `supabase/migrations/003_atomic_review.sql`, `src/server/services/reviews.ts`, `src/server/repositories/retrievalAttempts.ts`, `src/server/repositories/recallStates.ts`, `src/server/validation/schemas.ts`, `src/types/index.ts`, `src/lib/api.ts`.

1. Migration 003: add `client_request_id UUID` to `retrieval_attempts`, with a `UNIQUE (user_id, client_request_id)` index (the column is nullable so old rows stay valid).
2. Add an RPC `submit_review_tx(p_attempt jsonb, p_state jsonb)` (`SECURITY INVOKER`, so RLS applies) that inserts the attempt and upserts `recall_states` **in one transaction**. If the attempt hits the `client_request_id` conflict, return the existing attempt and the current state without writing anything.
3. Service: keep computing everything in TypeScript with the domain engine (the prediction before the outcome, then the new state), then make **one** RPC call. Remove the `ponytail:` two-write comment.
4. API: `POST /api/reviews` accepts an optional `clientRequestId` (uuid). The response shape is unchanged; add `duplicate: boolean`. Add `clientRequestId` to the `api.reviews.submit` input type.
5. **Verify the units:** the DB stores `self_reported_confidence` as 0–1, but the UI collects 1–5. Make sure the zod schema and service normalize it (1–5 → 0–1) in exactly one place, and document that place.
6. Validate the timestamps: `responseLatencyMs` is between 0 and 30 minutes, and the server sets `answered_at`.

**Done when:** posting the same body twice with the same `clientRequestId` creates 1 row and the second response has `duplicate: true`; forcing a failure on the state upsert (for example a temporary invalid value in a test) leaves **no** orphan attempt; and confidence values in the DB are 0–1.

---

## B3 — Study sessions API

**Files:** new `src/app/api/sessions/route.ts` (POST), new `src/app/api/sessions/[id]/route.ts` (PATCH), `src/server/services/reviews.ts`, `src/lib/api.ts`.

- `POST /api/sessions { mode }` returns `{ sessionId }`. `PATCH /api/sessions/:id { status: 'completed' | 'abandoned', summary? }` computes `concept_count` and a summary (correct, total, average confidence) **on the server, from that session's attempts**. It does not trust client-sent numbers.
- `submitReview`: if `sessionId` is given, check that the session belongs to the user and is `in_progress`; otherwise return 400.
- An abandoned session keeps its attempts.

**Done when:** a session completed via the API shows the right counts and another user's `sessionId` is rejected with 403 or 404.

---

## B4 — Review history and concept detail API

**Files:** `src/server/repositories/retrievalAttempts.ts`, `src/server/services/reviews.ts` (implement `getReviewHistory`), new `src/app/api/reviews/route.ts` **GET** handler (next to the existing POST), new `src/app/api/concepts/[id]/detail/route.ts`, `src/lib/api.ts`, `src/types/index.ts`.

- `GET /api/reviews?conceptId=&result=correct|incorrect&from=&to=&page=&pageSize=` returns a paginated list, newest first, joined with the concept's title or prompt and subject, plus a `total` count. Validate the parameters with zod and cap `pageSize` at 100.
- `GET /api/concepts/:id/detail` returns, in one call:
  - `concept` and `recallState`
  - the current `forecast` (1d/7d/30d horizons)
  - the last 50 `attempts`
  - `priority`: the output of `calculateSchedulingPriority`, including its **actual factor values**, so the UI can show "why it's prioritized" honestly
- Add a composite index if needed: `retrieval_attempts(user_id, answered_at DESC)` (fold it into migration 003 if B2 is still open; otherwise add `003b_history_index.sql`).

**Done when:** both endpoints return real data, filters and pagination work, and another user's concept id returns 404.

---

## B5 — Immutable forecast log and evaluation  *(the "prove it" feature)*

**Files:** new `supabase/migrations/004_forecast_log.sql`, new `src/server/repositories/forecasts.ts`, `src/server/services/reviews.ts`, new `src/app/api/forecasts/[conceptId]/log/route.ts`, `src/types/index.ts`, `src/lib/api.ts`.

- Table `forecast_log`:
  - `id`, `user_id`, `concept_id`
  - `generated_at`, `horizon_hours`, `target_at`
  - `predicted_probability`
  - `model_version`, `input_snapshot jsonb` (the recall state used)
  - `source_attempt_id`

  RLS: select and insert only for the owner, **no update or delete policy**, so rows are immutable.
- Table `forecast_evaluations`:
  - `forecast_id` (unique)
  - `attempt_id`, `observed_correct`
  - `evaluated_at`, `abs_error`

  It is kept separate so the forecast rows are never updated.
- When a review is submitted (inside or right after the B2 transaction), write 3 rows (1d, 7d, 30d). Then evaluate any **earlier** forecasts for that concept whose `target_at` falls within ±50% of the horizon of this attempt's `answered_at` (for example, a 7d forecast is evaluated by an attempt between 3.5d and 10.5d). Evaluate each forecast at most once and record the window rule in the code with a comment.
- `GET /api/forecasts/:conceptId/log` lists forecasts, each with `status: pending | evaluated | expired` and its evaluation if there is one.

**Done when:** three reviews of one concept at backdated times (use the B8 seed helper) produce logged forecasts, at least one evaluated forecast with the correct `abs_error`, and a failed `UPDATE` on `forecast_log` as a normal user (RLS denies it).

---

## B6 — Analytics v2

**Files:** `src/server/repositories/analytics.ts`, `src/domain/analytics/calibration.ts` (plus new pure functions), `src/app/api/analytics/route.ts`, `src/types/index.ts`, `tests/calibration.test.ts`.

Add these to the analytics response, keeping the existing fields:
- `immediateVsDelayed`: accuracy for attempts with an elapsed time under 24h versus 72h or more, with n for each.
- `calibration`: buckets from `calibrationBuckets()` with n per bucket, plus a `brierScore` and n.
- `baseline`: the Brier score of simple baselines **on the same attempts**: (a) the user's overall historical correctness rate, used as a constant prediction, computed with only past data at each point (no leakage); (b) a fixed-interval model with a single global half-life. Report `modelBeatsBaseline: boolean` and the difference. **This is the strongest slide in the pitch, so it must be computed honestly.**
- `forecastLog` summary (if B5 is done): evaluated count and mean absolute error by horizon.
- Every metric is `null` plus `insufficientData: true` below a minimum n (keep the existing 10). Never return a made-up number.
- Unit-test the new pure functions with tiny hand-computed fixtures.

**Done when:** on the B8 demo data the response contains every field with real n values, and the tests pass.

---

## B7 — Account: settings, export, delete

**Files:** new `supabase/migrations/005_profile_settings.sql`, new `src/app/api/me/route.ts` (GET / PATCH / DELETE), new `src/app/api/me/export/route.ts`, new `src/server/services/account.ts`, new server-only `src/server/db/admin.ts` (the service-role client), `src/lib/api.ts`, `src/types/index.ts`.

- Migration 005: add `daily_goal int default 20`, `target_recall real default 0.8 check (0.5–0.99)` and `is_demo boolean default false` to `profiles`.
- `GET /api/me` returns the profile and email. `PATCH /api/me` updates `display_name`, `preferred_timezone`, `daily_goal` and `target_recall` (validated with zod). `is_demo` can't be changed through PATCH.
- `GET /api/me/export` returns all of the user's concepts, recall states, attempts, sessions and forecast logs as a JSON file (`Content-Disposition: attachment`).
- `DELETE /api/me` with body `{ confirm: "DELETE" }` deletes the auth user through the admin client (`auth.admin.deleteUser`); the cascades remove the rest. Block deleting the demo account. `admin.ts` starts with `import 'server-only'`.
- Optional: the scheduler and dashboard use `target_recall` instead of a hard-coded 0.8. Grep for the constant first.

**Done when:** the settings round-trip works, the export downloads valid JSON with every table, deleting a throwaway user removes all of its rows (confirm with SQL), and the demo user can't be deleted.

---

## B8 — Demo account and realistic seed  *(replaces UI plan T10)*

**Files:** `scripts/seed.ts` (rewrite), new `scripts/seed-data.ts` (concept fixtures), `package.json` (scripts), `README.md` (demo section).

- `npm run db:seed` is idempotent: it creates or reuses the demo user `demo@forgetting-forecast.test` with a password from `DEMO_PASSWORD` in `.env.local` (add it to `.env.example`), and sets `profiles.is_demo = true`.
- About 15 concepts across DSA, Databases and Biology, with real prompts, answers and explanations.
- **Replay history through the real domain engine.** For each concept, simulate 3–10 attempts over the past 4–6 weeks. At each simulated timestamp, call `calculateRecallProbability` and `updateRecallState` with `now` set to that time, store exactly what the app would store, and choose outcomes with a seeded RNG weighted by that probability. The calibration data then behaves realistically instead of being hand-painted.
- Tune the RNG seed or offsets so today has 3–8 due concepts.
- `npm run db:reset-demo` wipes and re-seeds only the demo user's data. Run it before judging.
- The README gets a "Demo login" section with the credentials. These are a deliberate, public, sandboxed demo account, not a real secret. The UI's "Try the demo" pre-fills the sign-in form, so the password never sits in client code.

**Done when:** after a fresh seed, the dashboard shows 3–8 due items, analytics has no `insufficientData`, there are 100 or more attempts, and the B5 forecast log has evaluated entries.

---

## B9 — Tests  *(grows alongside the other tasks)*

**Files:** `tests/**`, new `scripts/test-rls.ts`, `package.json`.

- Unit tests (node:test, the existing runner): domain engine edge cases (first review, many lapses, a very long gap), confidence normalization, the B5 evaluation-window rule, and the B6 baselines.
- `npm run test:rls` (needs a reachable Supabase project): creates two throwaway users, then as user A tries to read, update and delete B's concepts, attempts, sessions and forecast logs **and calls every RPC**. It asserts zero rows or errors in every case, then cleans up. This is the security regression gate.
- `npm run test:api`: a smoke script against `npm run dev` that signs in as the demo user and exercises every route (status codes plus response shape checks).
- No new test frameworks.

**Done when:** `npm test`, `npm run test:rls` and `npm run test:api` all pass, with their output pasted in the report.

---

## B10 — Hardening and docs  *(last)*

**Files:** `src/app/api/**` (wrapper only), `src/server/errors/index.ts`, `src/lib/env/index.ts`, `src/app/api/health/route.ts`, `docs/api.md`, `docs/FEATURE_STATUS.md`, `README.md`.

- Move every route onto `createApiHandler()` and delete the duplicated requestId / try / catch blocks.
- Add a rate limit on the write routes (`POST /api/reviews`, `POST /api/concepts`, `DELETE /api/me`): an in-memory token bucket per user, about 60 requests a minute, returning 429. Mark it with `// ponytail: per-instance memory; move to Upstash/Redis if deployed multi-instance`.
- Log errors as structured lines with the requestId, route and code. **Never** log answers, prompts or tokens.
- `/api/health` also checks the DB with `select 1` (through a trivial query) and reports the migration level if that's cheap.
- Validate env at boot (`src/lib/env`): fail fast if a required variable is missing, and make sure the service-role key is never read in client bundles.
- Deployment checklist in the README: Vercel env vars, the Supabase Auth Site URL and redirect URLs (including `/auth/callback`), and the order to apply the migrations.
- Rewrite `docs/api.md` (every endpoint, request and response, error codes) and update `FEATURE_STATUS.md` to the real state.

**Done when:** a write flood gets a 429, every route returns the same error shape, the docs match the code, and the final `typecheck`, `lint`, `test`, `test:rls` and `build` all pass.

---

## 3. Definition of done (backend)

- [ ] No user can read or write another user's data through tables, RPCs or API routes (`test:rls` passes).
- [ ] Reviews are atomic and idempotent, and predictions are always computed on the server before the outcome is known.
- [ ] History, concept detail, sessions, account, export and delete endpoints exist and are documented.
- [ ] Forecasts are logged immutably and evaluated against later attempts.
- [ ] Analytics report calibration, Brier and baseline comparisons with sample sizes, and never fabricate numbers.
- [ ] The demo account has realistic replayed history and a one-command reset.
- [ ] `typecheck`, `lint`, `test`, `test:rls` and `build` are all green, and the docs match the code.
