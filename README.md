# Forgetting Forecast — Adaptive Recall Forecasting

A research-oriented web app that estimates how likely you are to remember each concept, tells you what to review before it fades, and **checks every forecast against what actually happened**.

Theme: retro-futurist synthwave ("a 1986 weather station that forecasts your memory").

## Demo login

The demo account holds **simulated sample data** (a replayed learner, not real study history). It is labelled `SAMPLE DATA` throughout the UI.

- Click **Try the demo** on `/welcome`. It signs in server-side, so the demo password is never sent to the browser.
- Or sign in manually: `demo@forgetting-forecast.test` with the `DEMO_PASSWORD` from your `.env.local` (a deliberate, public, sandboxed login; not a secret).
- `npm run db:seed` creates it (idempotent). `npm run db:reset-demo` wipes **only the demo user's** rows and rebuilds them. Run that before a demo.

The 90-second judge walkthrough is in [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

## What works

- **Forecasting engine** (`src/domain/forecasting`): exponential half-life model with a difficulty prior; pure functions, shared by the server and the UI.
- **Server-side predictions**: the probability stored with every attempt is computed on the server from the stored recall state **before** the outcome is applied. The client can't forge or skew it.
- **Atomic, idempotent reviews**: one Postgres transaction (`submit_review_tx`) writes the attempt and the recall state; a retried `clientRequestId` returns the original attempt and writes nothing.
- **Immutable forecast log**: after each review, 1-day, 7-day and 30-day forecasts are logged (insert-only, no UPDATE/DELETE policy) and later evaluated against real attempts inside a ±50%-of-horizon window.
- **Analytics v2**: immediate vs delayed accuracy, calibration (Brier + reliability bins), and a comparison with two simple baselines on the same attempts with no look-ahead. Every metric is `null` + `insufficientData` below 10 observations; nothing is invented.
- **Security**: row-level security on every table; RPCs run as the caller (`SECURITY INVOKER`, `auth.uid()`, no user-id parameter, `anon` revoked); open-redirect-safe auth callback; session-refreshing middleware; service-role key used only server-side.
- **Account**: settings, JSON export of every table, account deletion (the demo account is protected).
- **Study material (phase 1 of [docs/VISION_PLAN.md](docs/VISION_PLAN.md))**: upload PDF, PPTX, DOCX or TXT/MD; the app extracts text with page/slide numbers, builds an outline, and picks out key terms and definition sentences with **rules, not an LLM**. One click turns a term (or a passage you phrase) into a concept that keeps its link to "DBMS Notes, p. 12". Scanned PDFs fail with a clear message (no OCR).
- **Section quizzes (phase 2)**: rule-generated definition recall, cloze, term→definition multiple choice, true/false and numericals from formulas in the text. Multiple choice is graded exactly; short answers by word overlap + edit distance, and **every automatic grade shows an override step before it is saved**. Answers are recorded as normal attempts with the question type in their metadata; per-topic mastery is computed from them (null below 5 answers). Everything is labelled "Generated from p. N".
- **UI**: landing page, dashboard ("Memory Weather"), keyboard-driven review workspace, library, concept detail (forecast curve, real scheduling factors, attempts, forecast log), analytics, history, model lab, settings.

## Honest limitations

- The half-life update rule is a **heuristic**, not fitted to real learner data. Treat forecasts as unproven until Analytics shows they beat the baselines on **your** data. On the shipped demo seed the model does **not** beat the "your past accuracy" baseline; Analytics says so.
- The scheduler plans around a fixed 80% target. The *target recall* setting is stored on the profile but is not yet wired into scheduling.
- Rate limiting is in-memory (per instance). Use Redis/Upstash if you deploy more than one instance.
- Term and definition detection is pattern matching and will miss some and mis-detect a few; each term shows its source sentence so you can check it. Generated items are labelled as such. Auto-grading of short answers is a heuristic (hence the override step); numericals are practice-only; rules can't write "explain why" questions.
- Not done: FSRS, offline mode, OCR, YouTube.

## Architecture

```
src/
├── app/
│   ├── page.tsx, review/, library/, concepts/[id]/, analytics/, history/, model/, settings/   # app pages
│   ├── welcome/, auth/                                                                         # public pages
│   ├── dev/ui/                                       # UI QA sheet (404 in production)
│   └── api/                                          # route handlers (see docs/api.md)
├── components/        ui/ (primitives), charts/ (pure SVG), layout/ (shell), auth/
├── context/           AuthContext
├── domain/            forecasting/ (engine, evaluation), analytics/ (calibration, baselines): pure, no I/O
├── server/            routes -> services -> repositories -> domain; db/, validation/, errors/, rateLimit
├── lib/               api.ts (client), env/, safeNextPath
└── middleware.ts      session refresh + signed-out redirect
supabase/migrations/   001-006 (apply in order)
scripts/               seed.ts, seed-data.ts, test-rls.ts, test-api.ts
tests/                 unit tests (node:test)
docs/                  api.md, DEMO_SCRIPT.md, BACKEND_PLAN.md, REDESIGN_PLAN.md, BACKEND_BASELINE.md, ...
```

Layering: **route** (parse, validate, respond via `createApiHandler`) → **service** (auth + orchestration) → **repository** (SQL) → **domain** (pure maths, `now` passed in).

## Quick start

Prerequisites: Node 22.6+, npm, a Supabase project.

```bash
npm install
cp .env.example .env.local        # fill in the Supabase values and DEMO_PASSWORD
# apply supabase/migrations/001 ... 007 in order (SQL editor or `supabase db push`)
npm run db:seed                   # demo account + 15 concepts + replayed history
npm run dev
```

### Environment variables

| Variable | Description | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (used for every user request, so RLS applies) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key. **Server-only**: account deletion and the seed script | For deletion / seeding |
| `DEMO_PASSWORD` | Password of the public demo account (server-only) | For the demo |
| `NEXT_PUBLIC_APP_URL` | Application URL | No |
| `NODE_ENV` | `development` / `production` / `test` | No |

Never prefix the service-role key or `DEMO_PASSWORD` with `NEXT_PUBLIC_`.

### Scripts

```bash
npm run dev            # dev server
npm run build          # production build
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm test               # unit tests (domain engine, evaluation window, baselines, redirect guard)
npm run test:rls       # security gate: two throwaway users try to read/modify each other's data (needs Supabase)
npm run test:api       # smoke test of every route against a running dev server (API_BASE=http://localhost:3000)
npm run db:seed        # create/refresh the demo account (idempotent)
npm run db:reset-demo  # wipe and rebuild ONLY the demo user's data
```

## Forecasting model

```
P(recall at t) = 0.5 ^ (elapsed_hours / estimated_half_life_hours) * difficulty_adjustment
new_half_life  = old_half_life * outcome_factor * speed_factor * confidence_factor * difficulty_factor
```

Confidence is rated 1–5 in the UI and sent as `confidenceLevel`; the server converts it to the stored 0–1 value in exactly one place (`confidenceFromLevel`, `src/domain/forecasting/engine.ts`).

Validation plan: (1) collect delayed outcomes, (2) measure calibration with Brier score and reliability bins, (3) compare against baselines on the same attempts. Steps 2–3 are implemented on the Analytics page.

## Database

Tables: `profiles`, `concepts`, `recall_states`, `retrieval_attempts` (append-only), `study_sessions`, `forecast_log` (insert-only), `forecast_evaluations`, `sources`, `source_sections`, `source_terms`, plus the private `sources` Storage bucket. RLS everywhere. Migrations:

| File | Purpose |
|---|---|
| `001_initial_schema.sql` | tables, RLS, triggers |
| `002_secure_rpcs.sql` | closes the cross-user RPC leak (`SECURITY INVOKER`, `auth.uid()`) |
| `003_atomic_review.sql` | `submit_review_tx`, `client_request_id` idempotency key, history index |
| `004_forecast_log.sql` | immutable forecast log + evaluations |
| `005_profile_settings.sql` | `daily_goal`, `target_recall`, `is_demo` (users can't set `is_demo`) |
| `006_ownership_checks.sql` | INSERT policies require that the referenced concept is yours |
| `007_sources.sql` | uploaded study material: `sources`, `source_sections`, `source_terms`, concept→source link, private `sources` bucket, `ingest_source_tx` |

Migrations are additive and safe to re-run. Never edit `001`.

## Deployment checklist

1. **Vercel env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_PASSWORD`, `NEXT_PUBLIC_APP_URL`, `NODE_ENV=production`.
2. **Supabase migrations**: apply `001` → `006` in order.
3. **Supabase Auth settings**: set the Site URL to your production URL and add `https://<your-domain>/auth/callback` (and `/auth/reset-password`) to the redirect URLs.
4. **Seed the demo** (optional): run `npm run db:seed` once against production with the service-role key.
5. **Verify**: `npm run test:rls` against the production project (it creates and deletes its own throwaway users), then `GET /api/health`.
6. Rate limiting is per instance: add Redis/Upstash before scaling to multiple instances.

## License

MIT License.
