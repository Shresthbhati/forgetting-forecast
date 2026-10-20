# Forgetting Forecast — Implementation Plan

## Current State (Baseline)
- Next.js 15.5.3 + React 19.1.1 + TypeScript
- Single-page client-only app with localStorage persistence
- Basic exponential half-life forecasting engine (`lib/forecast.ts`)
- 5 unit tests passing
- Build passes, lint passes (with warnings)
- No backend, no database, no authentication, no API routes

## Target Architecture
```
src/
  app/
    (app)/
      dashboard/
      library/
      review/
      analytics/
      settings/
    api/
      health/
      dashboard/
      concepts/
      review-queue/
      reviews/
      forecasts/
      analytics/
  components/
    layout/
    dashboard/
    concepts/
    review/
    analytics/
    forms/
    feedback/
  features/
    dashboard/
    concepts/
    reviews/
    forecasting/
    analytics/
  server/
    auth/
    services/
    repositories/
    db/
    validation/
    errors/
  domain/
    concepts/
    reviews/
    scheduling/
    forecasting/
    analytics/
  lib/
    env/
    date/
    logging/
  types/
supabase/
  migrations/
tests/
  unit/
  integration/
  e2e/
docs/
  architecture.md
  data-model.md
  model-evaluation.md
  api.md
  implementation-plan.md
```

## Phase 1: Audit and Baseline ✓
- [x] Inspect repository
- [x] Run baseline tests (5 passing)
- [x] Run baseline build (passing)
- [x] Fix ESLint config

## Phase 2: Domain and Persistence
- [ ] Install Supabase client, Zod, and other dependencies
- [ ] Define domain types (`src/types/`)
- [ ] Create database schema and migrations (`supabase/migrations/`)
- [ ] Implement Supabase client setup (`src/server/db/`)
- [ ] Implement repository layer (`src/server/repositories/`)
- [ ] Add authentication middleware (`src/server/auth/`)
- [ ] Create development seed script

## Phase 3: Backend and Forecasting
- [ ] Create validation schemas (`src/server/validation/`)
- [ ] Implement error handling (`src/server/errors/`)
- [ ] Implement forecasting engine with versioning (`src/domain/forecasting/`)
- [ ] Implement scheduling policy (`src/domain/scheduling/`)
- [ ] Implement application services (`src/server/services/`)
- [ ] Create API routes:
  - [ ] `GET /api/health`
  - [ ] `GET /api/dashboard`
  - [ ] `GET/POST /api/concepts`
  - [ ] `GET/PATCH/DELETE /api/concepts/:id`
  - [ ] `GET /api/review-queue`
  - [ ] `POST /api/reviews`
  - [ ] `GET /api/forecasts/:conceptId`
  - [ ] `GET /api/analytics`
- [ ] Add unit tests for domain logic
- [ ] Add service tests

## Phase 4: Functional UI
- [ ] Create layout components
- [ ] Implement dashboard page with real API data
- [ ] Implement concept library with CRUD
- [ ] Implement review session lifecycle
- [ ] Implement forecast visualization
- [ ] Implement analytics view
- [ ] Add loading, empty, error states
- [ ] Connect UI to API routes

## Phase 5: Verification and Hardening
- [ ] Add API integration tests
- [ ] Add end-to-end tests
- [ ] Verify authentication and cross-user isolation
- [ ] Verify persistence through reloads
- [ ] Verify model logging integrity
- [ ] Run lint, typecheck, tests, production build
- [ ] Fix regressions

## Phase 6: Documentation and Handoff
- [ ] Update README.md
- [ ] Create docs/architecture.md
- [ ] Create docs/data-model.md
- [ ] Create docs/api.md
- [ ] Create docs/model-evaluation.md
- [ ] Create .env.example
- [ ] Document setup and troubleshooting

## Dependencies to Add
- `@supabase/supabase-js` - Database client
- `@supabase/ssr` - Server-side auth
- `zod` - Runtime validation
- `date-fns` - Date utilities
- `uuid` - UUID generation
- `@types/uuid` - Types
- `vitest` or similar for better testing (optional)

## Key Technical Decisions
1. **Forecasting Engine**: Keep the exponential half-life as baseline v1, but add proper versioning and model interface for future upgrades (FSRS, etc.)
2. **Database**: Supabase PostgreSQL with Row Level Security
3. **Authentication**: Supabase Auth with SSR
4. **Validation**: Zod schemas for all API inputs
5. **Testing**: Node.js built-in test runner for unit, Playwright for E2E (if feasible)
6. **Transactions**: Use Supabase RPC or pg transactions for review submission atomicity