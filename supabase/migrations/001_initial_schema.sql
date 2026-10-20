-- Initial schema for Forgetting Forecast
-- Run this in Supabase SQL editor or via migration tool

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    preferred_timezone TEXT DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Concepts table
CREATE TABLE IF NOT EXISTS public.concepts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    topic TEXT,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    explanation TEXT,
    difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
    tags TEXT[] NOT NULL DEFAULT '{}',
    source_reference TEXT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recall state table (one per concept per user)
CREATE TABLE IF NOT EXISTS public.recall_states (
    concept_id UUID PRIMARY KEY REFERENCES public.concepts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    model_version TEXT NOT NULL,
    initial_stability_days REAL NOT NULL DEFAULT 1.0,
    estimated_half_life_hours REAL NOT NULL CHECK (estimated_half_life_hours >= 0.5),
    repetition_count INTEGER NOT NULL DEFAULT 0,
    successful_recall_count INTEGER NOT NULL DEFAULT 0,
    lapse_count INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TIMESTAMPTZ,
    next_review_at TIMESTAMPTZ,
    last_predicted_recall_probability REAL CHECK (last_predicted_recall_probability BETWEEN 0 AND 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (concept_id, user_id)
);

-- Retrieval attempts (append-only, immutable)
CREATE TABLE IF NOT EXISTS public.retrieval_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.study_sessions(id) ON DELETE SET NULL,
    presented_at TIMESTAMPTZ NOT NULL,
    answered_at TIMESTAMPTZ NOT NULL,
    elapsed_since_previous_review_hours REAL,
    predicted_recall_probability REAL NOT NULL CHECK (predicted_recall_probability BETWEEN 0 AND 1),
    actual_correctness BOOLEAN NOT NULL,
    self_reported_confidence REAL CHECK (self_reported_confidence BETWEEN 0 AND 1),
    response_latency_ms INTEGER NOT NULL CHECK (response_latency_ms >= 0),
    model_version TEXT NOT NULL,
    scheduler_version TEXT NOT NULL,
    review_mode TEXT NOT NULL CHECK (review_mode IN ('due', 'practice', 'experiment')),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Study sessions
CREATE TABLE IF NOT EXISTS public.study_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    mode TEXT NOT NULL CHECK (mode IN ('due', 'practice', 'experiment')),
    concept_count INTEGER NOT NULL DEFAULT 0,
    summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_concepts_user_id ON public.concepts(user_id);
CREATE INDEX IF NOT EXISTS idx_concepts_user_id_archived ON public.concepts(user_id, archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_concepts_subject ON public.concepts(user_id, subject);
CREATE INDEX IF NOT EXISTS idx_recall_states_user_id ON public.recall_states(user_id);
CREATE INDEX IF NOT EXISTS idx_recall_states_next_review ON public.recall_states(user_id, next_review_at) WHERE next_review_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retrieval_attempts_user_id ON public.retrieval_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_attempts_concept_id ON public.retrieval_attempts(concept_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_attempts_answered_at ON public.retrieval_attempts(answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id ON public.study_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_started_at ON public.study_sessions(started_at DESC);

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recall_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retrieval_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Profiles: users can only see/update their own profile
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Concepts: users can only CRUD their own concepts
CREATE POLICY "concepts_select_own" ON public.concepts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "concepts_insert_own" ON public.concepts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "concepts_update_own" ON public.concepts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "concepts_delete_own" ON public.concepts FOR DELETE USING (auth.uid() = user_id);

-- Recall states: users can only see/update their own recall states
CREATE POLICY "recall_states_select_own" ON public.recall_states FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "recall_states_insert_own" ON public.recall_states FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "recall_states_update_own" ON public.recall_states FOR UPDATE USING (auth.uid() = user_id);

-- Retrieval attempts: users can only see/insert their own attempts
CREATE POLICY "retrieval_attempts_select_own" ON public.retrieval_attempts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "retrieval_attempts_insert_own" ON public.retrieval_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Study sessions: users can only see/insert/update their own sessions
CREATE POLICY "study_sessions_select_own" ON public.study_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "study_sessions_insert_own" ON public.study_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "study_sessions_update_own" ON public.study_sessions FOR UPDATE USING (auth.uid() = user_id);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, preferred_timezone)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name', COALESCE(NEW.raw_user_meta_data->>'timezone', 'UTC'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS concepts_updated_at ON public.concepts;
CREATE TRIGGER concepts_updated_at BEFORE UPDATE ON public.concepts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS recall_states_updated_at ON public.recall_states;
CREATE TRIGGER recall_states_updated_at BEFORE UPDATE ON public.recall_states FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Function to get due concepts for review queue
CREATE OR REPLACE FUNCTION public.get_due_concepts(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_mode TEXT DEFAULT 'due',
    p_subject TEXT DEFAULT NULL,
    p_forecast_horizon_hours INTEGER DEFAULT 168
)
RETURNS TABLE (
    concept_id UUID,
    subject TEXT,
    topic TEXT,
    prompt TEXT,
    answer TEXT,
    explanation TEXT,
    difficulty INTEGER,
    tags TEXT[],
    created_at TIMESTAMPTZ,
    estimated_half_life_hours REAL,
    repetition_count INTEGER,
    successful_recall_count INTEGER,
    lapse_count INTEGER,
    last_reviewed_at TIMESTAMPTZ,
    next_review_at TIMESTAMPTZ,
    last_predicted_recall_probability REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.subject,
        c.topic,
        c.prompt,
        c.answer,
        c.explanation,
        c.difficulty,
        c.tags,
        c.created_at,
        rs.estimated_half_life_hours,
        rs.repetition_count,
        rs.successful_recall_count,
        rs.lapse_count,
        rs.last_reviewed_at,
        rs.next_review_at,
        rs.last_predicted_recall_probability
    FROM public.concepts c
    JOIN public.recall_states rs ON rs.concept_id = c.id
    WHERE c.user_id = p_user_id
      AND c.archived_at IS NULL
      AND rs.user_id = p_user_id
      AND (
          p_mode = 'due' AND rs.next_review_at IS NOT NULL AND rs.next_review_at <= NOW()
          OR p_mode = 'practice'
          OR p_mode = 'experiment'
      )
      AND (p_subject IS NULL OR c.subject = p_subject)
    ORDER BY
        CASE
            WHEN rs.next_review_at IS NOT NULL AND rs.next_review_at <= NOW() THEN 0
            WHEN rs.next_review_at IS NOT NULL THEN 1
            ELSE 2
        END,
        rs.last_predicted_recall_probability ASC NULLS FIRST,
        rs.next_review_at ASC NULLS LAST
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get dashboard summary
CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_user_id UUID)
RETURNS TABLE (
    total_active_concepts BIGINT,
    due_concepts BIGINT,
    reviews_completed_today BIGINT,
    reviews_completed_this_week BIGINT,
    mean_estimated_recall REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM public.concepts WHERE user_id = p_user_id AND archived_at IS NULL)::BIGINT,
        (SELECT COUNT(*) FROM public.recall_states rs
         JOIN public.concepts c ON c.id = rs.concept_id
         WHERE rs.user_id = p_user_id AND c.archived_at IS NULL AND rs.next_review_at IS NOT NULL AND rs.next_review_at <= NOW())::BIGINT,
        (SELECT COUNT(*) FROM public.retrieval_attempts
         WHERE user_id = p_user_id AND answered_at >= NOW() - INTERVAL '1 day')::BIGINT,
        (SELECT COUNT(*) FROM public.retrieval_attempts
         WHERE user_id = p_user_id AND answered_at >= NOW() - INTERVAL '7 days')::BIGINT,
        (SELECT COALESCE(AVG(rs.last_predicted_recall_probability), 0) FROM public.recall_states rs
         JOIN public.concepts c ON c.id = rs.concept_id
         WHERE rs.user_id = p_user_id AND c.archived_at IS NULL AND rs.last_predicted_recall_probability IS NOT NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;