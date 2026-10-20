# Architecture Documentation

## Overview

Forgetting Forecast follows a layered architecture designed for maintainability, testability, and separation of concerns. The application is built with Next.js 15 App Router, React 19, TypeScript, and Supabase.

## Architectural Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                         │
│  React Components, Pages, Forms, UI State                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      API/HTTP Layer                           │
│  Route Handlers, Request Validation, Auth, Error Handling   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Application Service Layer                   │
│  Use Cases: createConcept, submitReview, getDashboard, etc. │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Domain Layer                             │
│  Forecasting Engine, Scheduling Policy, Domain Types         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Repository Layer                            │
│  Data Access: concepts, recallStates, retrievalAttempts,    │
│  studySessions, analytics                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Database Layer                             │
│  Supabase PostgreSQL, Migrations, RLS Policies              │
└─────────────────────────────────────────────────────────────┘
```

## Request Flow

```
User Action (UI)
    │
    ▼
API Route Handler (app/api/*/route.ts)
    │
    ├── Authentication (getUser)
    ├── Validation (Zod schema)
    ▼
Application Service (server/services/*)
    │
    ├── Business Logic Orchestration
    ├── Domain Function Calls
    ▼
Domain Functions (domain/*)
    │
    ├── Pure Calculations
    ├── No Side Effects
    ▼
Repository (server/repositories/*)
    │
    ├── Database Queries
    ├── Data Mapping
    ▼
Supabase PostgreSQL
```

## Key Design Decisions

### 1. Layered Architecture
Each layer has a single responsibility:
- **Presentation**: Only rendering and user interaction
- **API**: HTTP concerns only (auth, validation, serialization)
- **Services**: Application use cases, transaction boundaries
- **Domain**: Pure business logic, no I/O, fully testable
- **Repositories**: Database access, data mapping
- **Database**: Schema, constraints, RLS

### 2. Domain-Driven Design
The forecasting engine and scheduling policy are pure functions in `domain/forecasting/engine.ts`. They:
- Have no dependencies on HTTP, database, or React
- Are deterministic for given inputs
- Can be tested in isolation
- Can be swapped without affecting other layers

### 3. Type Safety
- Shared types in `src/types/index.ts`
- Zod schemas for runtime validation
- Branded types for domain primitives (UUID, Probability, etc.)
- Strict TypeScript configuration

### 4. Error Handling
- Custom error classes (`AppError`, `ValidationError`, etc.)
- Structured error responses with request IDs
- No sensitive data in error responses
- Errors logged server-side, user-friendly messages returned

### 5. Authentication & Authorization
- Supabase Auth with SSR
- Row Level Security (RLS) at database level
- Ownership checks in repositories and services
- Service role key only on server

### 6. Data Integrity
- Immutable retrieval attempts (append-only)
- Model version recorded with every prediction
- Transactional review submission (attempt + state update)
- Optimistic concurrency for concurrent updates

## Data Flow: Review Submission

```
POST /api/reviews
    │
    ├── Auth: getUser()
    ├── Validate: submitReviewSchema
    ▼
submitReview(input)
    │
    ├── Get concept (verify ownership)
    ├── Get/create recall state
    ├── Calculate elapsed time
    ▼
createRetrievalAttempt()
    │
    ├── Insert immutable attempt record
    │   (includes pre-answer prediction)
    ▼
updateRecallStateDomain()
    │
    ├── Pure function: calculate new half-life
    ├── Return updated state + forecast
    ▼
updateRecallState() (repository)
    │
    ├── Persist new half-life, counts, next_review_at
    ▼
Return: attempt, concept, updated state, forecast
```

## Forecasting Engine

### Model Interface
```typescript
interface RecallForecastEngine {
  predict(input: ForecastInput): ForecastResult;
  scheduleNext(input: SchedulingInput): SchedulingResult;
  updateAfterReview(input: ReviewOutcome): UpdatedRecallState;
}
```

### Current Implementation: Exponential Half-Life v1
- `P(recall) = 0.5 ^ (elapsed / half_life) * difficulty_adjustment`
- Half-life updated after each review using outcome, latency, confidence
- Versioned: `exponential-half-life-v1`

### Extensibility
To add a new model (e.g., FSRS):
1. Implement `RecallForecastEngine` interface
2. Add new model version constant
3. Update repository to store new state fields
4. Add migration for new columns
5. Update service to use new engine

## Scheduling Policy

### Priority Factors
1. **Recall Probability** (lower = higher priority)
2. **Overdue Status** (overdue = +0.3 priority)
3. **Uncertainty** (few reviews = higher priority for exploration)

### Queue Ordering
```
ORDER BY
  CASE WHEN next_review_at <= NOW() THEN 0 ELSE 1 END,  // Overdue first
  last_predicted_recall_probability ASC,                // Lower recall first
  next_review_at ASC                                     // Soonest due first
```

## Security

### Database
- RLS policies on all user tables
- Service role key only in server environment
- No direct database access from client

### API
- All inputs validated with Zod
- Ownership verified for every operation
- Rate limiting (planned)
- CORS configured

### Client
- No secrets in client bundle
- Supabase anon key for client operations
- Auth tokens in httpOnly cookies

## Performance

### Database
- Indexes on user_id, next_review_at, answered_at
- Composite indexes for common query patterns
- RPC functions for complex aggregations

### Caching
- Dashboard data cached per request (planned)
- Forecast computations are fast (pure functions)
- Static generation for marketing pages

## Monitoring

### Health Checks
- `GET /api/health` returns database status
- Structured logging with request IDs

### Metrics (Planned)
- Review submission latency
- Forecast calibration tracking
- Error rates by endpoint
- User engagement metrics

## Future Considerations

### Model Upgrades
- FSRS integration (separate engine implementation)
- A/B testing framework for model comparison
- Calibration monitoring dashboard

### Scalability
- Read replicas for analytics queries
- Background jobs for heavy computations
- CDN for static assets

### Offline Support
- Service worker for review queue
- IndexedDB for local storage
- Background sync on reconnect