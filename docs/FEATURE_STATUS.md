# Feature status

Last verified against the code and a live Supabase project on 2026-10-20. This file replaces the earlier, partly stale audit.

Legend: ✅ works and was exercised · 🟡 works with a stated limit · ⬜ not built

## Backend

| Area | Status | Notes |
|---|---|---|
| Schema + RLS (7 tables) | ✅ | `supabase/migrations/001`–`006`; `npm run test:rls` asserts isolation (37 checks) |
| Cross-user RPC leak | ✅ fixed | `002`: `SECURITY INVOKER`, `auth.uid()`, `anon` revoked; the old `p_user_id` signatures no longer exist |
| Open redirect in `/auth/callback` | ✅ fixed | `src/lib/safeNextPath.ts` + unit tests |
| Session refresh + signed-out redirect | ✅ | `src/middleware.ts` |
| Atomic review write | ✅ | `submit_review_tx`: attempt + recall state in one transaction |
| Idempotent reviews | ✅ | `clientRequestId` unique per user; duplicates return `duplicate: true` and write nothing |
| Server-computed prediction | ✅ | computed before the outcome is applied; client-sent predictions are ignored |
| Confidence normalisation | ✅ | 1–5 → 0–1 in one function (`confidenceFromLevel`) |
| Study sessions API | ✅ | counts/summary computed server-side from the session's attempts |
| Review history + concept detail | ✅ | `GET /api/reviews`, `GET /api/concepts/:id/detail` |
| Immutable forecast log + evaluation | ✅ | insert-only tables; ±50%-of-horizon window rule, unit-tested |
| Analytics v2 | ✅ | immediate vs delayed, calibration, baselines (no look-ahead), forecast-log MAE; `null` below 10 samples |
| Account: settings / export / delete | ✅ | demo account protected; service-role client is server-only (`import 'server-only'`) |
| Demo account + replayed seed | ✅ | `npm run db:seed`, `npm run db:reset-demo`; history is simulated and labelled as such |
| Uniform error shape + request ids | ✅ | every route uses `createApiHandler` |
| Write rate limit | 🟡 | in-memory per instance (60/min/user/scope); move to Redis/Upstash for multi-instance |
| Scheduler uses `target_recall` | ⬜ | stored on the profile; the engine plans around a fixed 80% |
| Reads paginated past 1,000 rows | 🟡 | PostgREST caps responses at 1,000 rows; analytics and the stats query note this limit |

## Frontend

| Page | Status | Notes |
|---|---|---|
| `/welcome` | ✅ | public landing; one-click demo via `/api/demo-login` |
| `/auth/*` | ✅ | restyled; `callbackUrl` sanitised to same-site paths |
| `/` dashboard | ✅ | next action, 4 tiles (`ESTIMATE` / `OBSERVED`), curve, queue with real "why", upcoming risk |
| `/review` | ✅ | keyboard-first, pause stops the latency timer, idempotent retry, "NOT SAVED" path, session summary |
| `/library` | ✅ | search, subject filter, add/delete dialogs, recall rings |
| `/concepts/[id]` | ✅ | forecast curve, real scheduler factors, attempts, forecast log, edit/delete |
| `/analytics` | ✅ | every number shows n; baseline result reported even when the model loses |
| `/history` | ✅ | filters + pagination over `GET /api/reviews` |
| `/model` | ✅ | time-machine simulation (labelled SIMULATION) on real recall states |
| `/settings` | ✅ | real profile/study/password/export/delete; display toggles persist in `localStorage` |
| `/dev/ui` | ✅ | QA sheet for every primitive and chart; 404 in production |
| Responsive (375px) | ✅ | no horizontal page scroll on any route (checked in a browser); bottom tab bar under 1024px |
| Contrast | ✅ | every text/background token pair ≥ 4.5:1 (computed, see below) |
| Reduced motion | ✅ | `prefers-reduced-motion` and a Settings switch stop the grid, draw-in and shimmer |

## Known limitations

- The half-life model is heuristic and unvalidated. On the shipped demo seed it **does not** beat the "your past accuracy" baseline; the Analytics page reports that.
- Demo data is simulated; its calibration shows the pipeline works, not that the model predicts real people.
- Not built: FSRS, offline mode, data import, e2e browser tests, Lighthouse CI.

## Contrast (computed WCAG ratios on `night` / `panel` / `panel-hi`)

`ink` 14.3–16.8 · `ink-dim` 6.8–8.0 · `neutral-400` 4.7–5.5 · `magenta` 5.2–6.1 · `cyan` 10.7–12.6 · `strong` 12.6–14.9 · `watch` 11.4–13.4 · `due` 4.9–5.8 · `sunset` 7.0–8.3. Button labels: `void` on magenta 6.4, on sunset 8.7, on cyan 13.2, on due 6.0.
