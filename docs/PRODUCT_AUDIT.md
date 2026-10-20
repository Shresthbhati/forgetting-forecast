# Forgetting Forecast - Product Audit

## Repository Overview

**Project**: Forgetting Forecast - Adaptive Learning & Memory Intelligence Product
**Stack**: Next.js 15.5.3, React 19.1.1, TypeScript, Supabase, PostgreSQL
**Current Status**: Functional prototype with complete backend and frontend integration

## Architecture Assessment

### ✅ Working Components

1. **Frontend** (app/page.tsx)
   - Single-page application with 4 tabs: Overview, Library, Session, Model Lab
   - Protected routes with Supabase SSR authentication
   - Real API integration for concepts, reviews, forecasting
   - Local state management with optimistic updates

2. **Backend API Routes** (src/app/api/)
   - `/api/health` - Health check
   - `/api/dashboard` - Dashboard summary
   - `/api/concepts` - CRUD for concepts
   - `/api/concepts/[id]` - Individual concept operations
   - `/api/review-queue` - Prioritized review queue
   - `/api/reviews` - Review submission
   - `/api/forecasts/[conceptId]` - Forecast data
   - `/api/analytics` - Learning analytics

3. **Domain Layer** (src/domain/forecasting/)
   - Exponential half-life forecasting engine
   - Scheduling priority calculation
   - Horizon forecasts
   - Recall state initialization

4. **Services Layer** (src/server/services/)
   - Concepts management
   - Review submission pipeline
   - Forecasting and prioritization

5. **Repositories** (src/server/repositories/)
   - Concepts, Recall States, Retrieval Attempts, Study Sessions, Analytics

5. **Database Schema** (Supabase/PostgreSQL)
   - Tables: profiles, concepts, recall_states, retrieval_attempts, study_sessions
   - RLS policies for user isolation
   - RPC functions for dashboard and review queue
   - Triggers for auto-profile creation and updated_at

6. **Authentication** (Supabase SSR)
   - Server-side cookie handling
   - Browser client for client-side auth
   - Auth context with sign in/up/out/reset

7. **Tests**
   - 6 unit tests for forecasting engine (all passing)

### 🔴 Critical Issues Identified

#### 1. **Missing Design System**
- No centralized design tokens (colors, spacing, typography)
- Inconsistent styling across components
- Hardcoded CSS classes in page.tsx
- No shared component library

#### 2. **UI/UX Issues**
- Single-page application with tab-based navigation (not scalable)
- Hardcoded seed data in page.tsx (4 concepts)
- No dedicated concept detail page
- No analytics page implementation
- No recall history page
- No settings/account pages
- Model Lab is a simulation tool, not a proper model exploration page

#### 3. **Backend Gaps**
- No concept detail endpoint with full review history
- No review history endpoint
- No analytics dashboard endpoint with full data
- No reconciliation engine (this is a forecasting product, not reconciliation)
- No audit event logging
- No concept tags/categories in API

#### 4. **UI/UX Missing Features**
- No concept detail page
- No analytics dashboard page
- No recall history page
- No settings/account management
- No proper empty states for new users
- No proper loading skeletons
- No toast notifications
- No confirmation dialogs for destructive actions

#### 5. **Security/Architecture Concerns**
- Auth callback uses anon key instead of service role key
- ESLint config missing Next.js plugin
- Multiple lockfiles warning
- No rate limiting on API routes
- No request size limits

#### 6. **Missing Pages/Routes**
- `/concepts/[id]` - Concept detail page
- `/analytics` - Analytics dashboard
- `/history` - Recall history
- `/settings` - User settings
- `/auth/reset-password` - Password reset completion

### 🟡 Medium Priority Issues

1. **Authentication Callback** - Uses anon key instead of service role key
2. **ESLint Config** - Missing Next.js plugin
3. **Multiple Lockfiles** - Parent and project lockfiles
4. **Seed Data** - Only 4 concepts, no review history
5. **No Analytics Page** - Analytics API exists but no UI
7. **No Concept Detail Page** - Can't view individual concept details
8. **No Recall History Page** - Can't view past reviews
9. **No Settings Page** - No user preferences management
9. **No Proper Error Boundaries** - No React error boundaries

### 🟢 Low Priority / Nice to Have

1. **Dark Mode Support** - Only light theme implemented
2. **Keyboard Shortcuts** - No keyboard navigation for review session
3. **Export/Import** - Basic JSON export only
4. **Keyboard Shortcuts Help** - No help dialog
5. **Model Comparison** - No baseline comparison in analytics

## Implementation Priority

### Phase 1: Foundation (Week 1)
1. Create design system with tokens and shared components
2. Build application shell with proper navigation
4. Fix ESLint config and lockfile issues
5. Fix auth callback to use service role key

### Phase 2: Core Pages (Week 1-2)
1. Redesign Overview Dashboard with real metrics
2. Build Concepts Library with proper CRUD
3. Create Concept Detail page
5. Build Review Session with proper UX
6. Build Review Queue with proper prioritization

### Phase 3: Missing Pages (Week 2)
1. Analytics Dashboard page
2. Recall History page
3. Concept Detail page
4. Settings/Account page
5. Auth pages improvements

### Phase 4: Backend Completion (Week 2-3)
1. Add concept detail endpoint with review history
3. Add review history endpoint
4. Add analytics endpoint with full data
5. Add audit event logging
6. Fix auth callback to use service role key

### Phase 5: Polish & Testing (Week 3)
1. Add design system components
2. Add proper loading/error/empty states
3. Add toast notifications
4. Add confirmation dialogs
5. Add responsive design improvements
6. Run all tests and verify build

## Current Test Results

```
✔ recall probability falls as time passes
✔ a correct review increases estimated half-life
✔ an incorrect review reduces estimated half-life
✔ forecast returns a valid probability and status
✔ a future forecast does not increase recall without a review
✔ initializeRecallState creates valid initial state

Tests: 6 passed
```

## Build Status

- TypeScript: ✅ Pass
- ESLint: ✅ Pass (with warning about missing Next.js plugin)
- Build: ✅ Pass (with warnings)
- Tests: ✅ 6/6 passing

## Environment Requirements

- Node.js 22+
- Supabase project with:
  - Database with migration applied
  - Auth enabled (email/password)
  - RLS policies enabled
- Environment variables in `.env.local`

## Next Steps

1. Create design system foundation
2. Build application shell with proper navigation
3. Redesign each page with proper components
4. Implement missing pages
5. Complete backend endpoints
6. Add comprehensive tests
7. Polish UI/UX