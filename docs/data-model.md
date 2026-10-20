# Data Model Documentation

## Overview

This document describes the database schema, relationships, constraints, and access patterns for Forgetting Forecast.

## Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌────────────────────┐
│  profiles   │       │  concepts   │       │  recall_states     │
├─────────────┤       ├─────────────┤       ├────────────────────┤
│ id (PK)     │◄──────│ user_id (FK)│       │ concept_id (PK,FK) │
│ display_name│       │ id (PK)     │◄──────│ user_id (FK)       │
│ timezone    │       │ subject     │       │ model_version      │
│ created_at  │       │ topic       │       │ initial_stability  │
│ updated_at  │       │ prompt      │       │ half_life_hours    │
└─────────────┘       │ answer      │       │ repetition_count   │
                      │ difficulty  │       │ successful_count   │
                      │ tags        │       │ lapse_count        │
                      │ archived_at │       │ last_reviewed_at   │
                      │ created_at  │       │ next_review_at     │
                      │ updated_at  │       │ last_predicted_p   │
                      └──────┬──────┘       │ updated_at         │
                             │             └────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │retrieval_  │ │  study_    │ │  (future)  │
       │  attempts  │ │  sessions  │ │  entities  │
       ├────────────┤ ├────────────┤ ├────────────┤
       │ id (PK)    │ │ id (PK)    │ │            │
       │ user_id(FK)│ │ user_id(FK)│ │            │
       │ concept_id │ │ mode       │ │            │
       │ session_id │ │ status     │ │            │
       │ predicted_p│ │ concept_cnt│ │            │
       │ actual_corr│ │ started_at │ │            │
       │ confidence │ │ completed_ │ │            │
       │ latency_ms │ │ summary    │ │            │
       │ model_ver  │ │ created_at │ │            │
       │ created_at │ └────────────┘ │            │
       └────────────┘                └────────────┘
```

## Table Definitions

### 1. profiles
Extends Supabase `auth.users` with application-specific data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, FK → auth.users.id | User identifier |
| display_name | TEXT | NULLABLE | User's display name |
| preferred_timezone | TEXT | DEFAULT 'UTC' | IANA timezone |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update timestamp |

**Indexes**: PK on `id`
**RLS**: Users can only SELECT/UPDATE/INSERT own profile

### 2. concepts
Core learning items that users want to remember.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() | Concept identifier |
| user_id | UUID | NOT NULL, FK → profiles.id | Owner |
| subject | TEXT | NOT NULL | Subject/category (e.g., "DBMS") |
| topic | TEXT | NULLABLE | Subtopic (e.g., "Relational Algebra") |
| prompt | TEXT | NOT NULL | Recall question |
| answer | TEXT | NOT NULL | Expected answer |
| explanation | TEXT | NULLABLE | Why the answer is correct |
| difficulty | INTEGER | NOT NULL, CHECK (1-5) | Difficulty rating 1-5 |
| tags | TEXT[] | NOT NULL, DEFAULT '{}' | Searchable tags |
| source_reference | TEXT | NULLABLE | Source citation |
| archived_at | TIMESTAMPTZ | NULLABLE | Soft delete timestamp |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update timestamp |

**Indexes**:
- `idx_concepts_user_id` ON (user_id)
- `idx_concepts_user_id_archived` ON (user_id, archived_at) WHERE archived_at IS NULL
- `idx_concepts_subject` ON (user_id, subject)

**RLS**: Users can only CRUD own concepts

### 3. recall_states
Scheduling state for each concept (one per concept per user).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| concept_id | UUID | PK, FK → concepts.id | Concept reference |
| user_id | UUID | NOT NULL, FK → profiles.id | Owner (denormalized) |
| model_version | TEXT | NOT NULL | Forecasting model version |
| initial_stability_days | REAL | NOT NULL, DEFAULT 1.0 | Initial stability |
| estimated_half_life_hours | REAL | NOT NULL, CHECK (>= 0.5) | Current half-life estimate |
| repetition_count | INTEGER | NOT NULL, DEFAULT 0 | Total reviews |
| successful_recall_count | INTEGER | NOT NULL, DEFAULT 0 | Correct recalls |
| lapse_count | INTEGER | NOT NULL, DEFAULT 0 | Failed recalls |
| last_reviewed_at | TIMESTAMPTZ | NULLABLE | Last review timestamp |
| next_review_at | TIMESTAMPTZ | NULLABLE | Next recommended review |
| last_predicted_recall_probability | REAL | NULLABLE, CHECK (0-1) | Pre-answer prediction |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update |

**Indexes**:
- `idx_recall_states_user_id` ON (user_id)
- `idx_recall_states_next_review` ON (user_id, next_review_at) WHERE next_review_at IS NOT NULL

**Constraints**: UNIQUE (concept_id, user_id)

**RLS**: Users can only CRUD own recall states

### 4. retrieval_attempts
Immutable log of every review attempt (append-only).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() | Attempt identifier |
| user_id | UUID | NOT NULL, FK → profiles.id | Owner |
| concept_id | UUID | NOT NULL, FK → concepts.id | Concept reviewed |
| session_id | UUID | FK → study_sessions.id | Session (nullable) |
| presented_at | TIMESTAMPTZ | NOT NULL | When prompt was shown |
| answered_at | TIMESTAMPTZ | NOT NULL | When answer submitted |
| elapsed_since_previous_review_hours | REAL | NULLABLE | Hours since last review |
| predicted_recall_probability | REAL | NOT NULL, CHECK (0-1) | Pre-answer forecast |
| actual_correctness | BOOLEAN | NOT NULL | User's self-grade |
| self_reported_confidence | REAL | NULLABLE, CHECK (0-1) | User confidence 0-1 |
| response_latency_ms | INTEGER | NOT NULL, CHECK (>= 0) | Response time |
| model_version | TEXT | NOT NULL | Model used for prediction |
| scheduler_version | TEXT | NOT NULL | Scheduler version |
| review_mode | TEXT | NOT NULL, CHECK (in due/practice/experiment) | Review context |
| metadata | JSONB | NULLABLE | Extensible metadata |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Record creation |

**Indexes**:
- `idx_retrieval_attempts_user_id` ON (user_id)
- `idx_retrieval_attempts_concept_id` ON (concept_id)
- `idx_retrieval_attempts_answered_at` ON (answered_at DESC)

**RLS**: Users can only SELECT/INSERT own attempts

**Immutability**: No UPDATE or DELETE policies - attempts are permanent records

### 5. study_sessions
Groups review attempts into study sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() | Session identifier |
| user_id | UUID | NOT NULL, FK → profiles.id | Owner |
| started_at | TIMESTAMPTZ | NOT NULL | Session start |
| completed_at | TIMESTAMPTZ | NULLABLE | Session end |
| status | TEXT | NOT NULL, DEFAULT 'in_progress', CHECK (in_progress/completed/abandoned) | Session state |
| mode | TEXT | NOT NULL, CHECK (due/practice/experiment) | Review mode |
| concept_count | INTEGER | NOT NULL, DEFAULT 0 | Concepts reviewed |
| summary | JSONB | NULLABLE | Session summary stats |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Record creation |

**Indexes**:
- `idx_study_sessions_user_id` ON (user_id)
- `idx_study_sessions_started_at` ON (started_at DESC)

**RLS**: Users can only CRUD own sessions

## Key Relationships

1. **profiles → concepts**: One-to-Many (user owns concepts)
2. **concepts → recall_states**: One-to-One (each concept has one state)
3. **concepts → retrieval_attempts**: One-to-Many (concept has many attempts)
4. **profiles → retrieval_attempts**: One-to-Many (user has many attempts)
5. **study_sessions → retrieval_attempts**: One-to-Many (session groups attempts)
6. **profiles → study_sessions**: One-to-Many (user has many sessions)

## Access Patterns & Indexes

### Common Queries

| Query | Index Used |
|-------|------------|
| Get user's active concepts | `idx_concepts_user_id_archived` |
| Get user's concepts by subject | `idx_concepts_subject` |
| Get due concepts for review queue | `idx_recall_states_next_review` |
| Get concept's review history | `idx_retrieval_attempts_concept_id` |
| Get user's recent attempts | `idx_retrieval_attempts_user_id` + `idx_retrieval_attempts_answered_at` |
| Get user's sessions | `idx_study_sessions_user_id` |

### Index Strategy
- All foreign keys indexed
- Partial indexes for filtered queries (e.g., `archived_at IS NULL`)
- Composite indexes for multi-column filters
- DESC ordering for time-based pagination

## Row Level Security (RLS)

All user-owned tables have RLS enabled with policies:

```sql
-- Example: concepts
CREATE POLICY "concepts_select_own" ON concepts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "concepts_insert_own" ON concepts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "concepts_update_own" ON concepts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "concepts_delete_own" ON concepts FOR DELETE USING (auth.uid() = user_id);
```

**Principle**: Defense in depth - RLS at database level + ownership checks in application services.

## Triggers

### Auto-profile creation
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, preferred_timezone)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name', COALESCE(NEW.raw_user_meta_data->>'timezone', 'UTC'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### Auto-updated_at
```sql
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER concepts_updated_at BEFORE UPDATE ON concepts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
-- Similar triggers for profiles, recall_states
```

## RPC Functions

### `get_due_concepts(p_user_id, p_limit, p_mode, p_subject, p_forecast_horizon_hours)`
Returns concepts due for review with scheduling priority.

### `get_dashboard_summary(p_user_id)`
Returns aggregated dashboard metrics.

## Migration Strategy

### Versioning
Migrations are numbered sequentially: `001_initial_schema.sql`, `002_add_xyz.sql`, etc.

### Applying Migrations
Run in Supabase SQL Editor or via CLI:
```bash
supabase db push
```

### Backward Compatibility
- New columns are NULLABLE or have DEFAULTs
- No destructive changes (DROP COLUMN) without migration plan
- Model version recorded with every prediction for traceability

## Data Retention

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| Concepts | Indefinite | Until user deletes |
| Recall States | Indefinite | Tied to concepts |
| Retrieval Attempts | Indefinite | Immutable, never deleted |
| Study Sessions | Indefinite | |
| Profiles | Indefinite | Until account deletion |

## Backup & Recovery

- Supabase provides automatic daily backups
- Point-in-time recovery available
- Export via `supabase db dump` for manual backups

## Future Schema Changes

### Planned Additions
1. **Concept embeddings** - Vector column for semantic search
2. **Model comparison tables** - A/B test results
3. **Notification preferences** - User settings table
4. **Shared concepts** - Collaboration features

### Migration Guidelines
- Always provide DEFAULT for new NOT NULL columns
- Use `IF NOT EXISTS` for idempotent migrations
- Test migrations on staging before production
- Document breaking changes in CHANGELOG