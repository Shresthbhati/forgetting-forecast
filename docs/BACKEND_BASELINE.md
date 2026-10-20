# Backend baseline (B0)

Recorded 2026-10-20 before the security fixes were applied.

## Environment

- `.env.local` points at the Supabase project **forgetting forecast** (`sugenakkxcnyqusjvqsn`, `ap-south-1`, status `ACTIVE_HEALTHY`, Postgres 17).
- Migration `001_initial_schema.sql` was applied: 5 tables (`profiles`, `concepts`, `recall_states`, `retrieval_attempts`, `study_sessions`) and the two RPCs.
- The database was **empty** (0 auth users, 0 concepts, 0 attempts).

## Local checks (before any backend change)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 8 / 8 pass |
| `npm run build` | succeeds; route table includes all API routes and `/auth/signin` |
| `GET /api/health` | `200`, `database: healthy` |
| signed-out `GET /api/concepts` | `401` |

## The cross-user leak (problem #1)

Inspected `pg_proc` on the live project:

| Function | `SECURITY DEFINER` | `anon` can EXECUTE | takes a user id |
|---|---|---|---|
| `get_due_concepts(p_user_id uuid, p_limit int, p_mode text, p_subject text, p_forecast_horizon_hours int)` | **yes** | **yes** | **yes** |
| `get_dashboard_summary(p_user_id uuid)` | **yes** | **yes** | **yes** |

`SECURITY DEFINER` bypasses RLS, and Postgres grants `EXECUTE` to `PUBLIC` by default, so anyone holding the public anon key could call `supabase.rpc('get_due_concepts', { p_user_id: <victim> })` and read that user's concepts and answers. **Ruled in by inspection, not by exploit:** with 0 users there was no second account whose rows could be returned, so the two-user repro was not run before the fix.

## After the fix

Migration `002_secure_rpcs.sql` (and `006` for INSERT ownership) was applied to the same project. `npm run test:rls` creates two throwaway users, has user A try to read, update and delete user B's rows and call every RPC, and asserts zero rows or an error in every case. Result: **37 passed, 0 failed**, including:

- `get_due_concepts` / `get_dashboard_summary` as A never include B's data;
- the old `p_user_id` signatures no longer exist;
- `anon` cannot execute either RPC or `submit_review_tx`;
- `forecast_log` UPDATE and DELETE are denied even for the owner;
- A cannot attach an attempt or recall state to B's concept (migration 006).

Also verified by `npm run test:api` (55 checks against a running server): `?next=@evil.com` redirects on-site, signed-out routes return `401`, a write flood returns `429`.
