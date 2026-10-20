-- B5: immutable forecast log + separate evaluations. No UPDATE/DELETE policies => users cannot change rows.

CREATE TABLE IF NOT EXISTS public.forecast_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
    generated_at TIMESTAMPTZ NOT NULL,
    horizon_hours INTEGER NOT NULL CHECK (horizon_hours > 0),
    target_at TIMESTAMPTZ NOT NULL,
    predicted_probability REAL NOT NULL CHECK (predicted_probability BETWEEN 0 AND 1),
    model_version TEXT NOT NULL,
    input_snapshot JSONB NOT NULL,
    source_attempt_id UUID REFERENCES public.retrieval_attempts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_forecast_log_concept ON public.forecast_log (user_id, concept_id, target_at);

CREATE TABLE IF NOT EXISTS public.forecast_evaluations (
    forecast_id UUID PRIMARY KEY REFERENCES public.forecast_log(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES public.retrieval_attempts(id) ON DELETE CASCADE,
    observed_correct BOOLEAN NOT NULL,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    abs_error REAL NOT NULL CHECK (abs_error BETWEEN 0 AND 1)
);

ALTER TABLE public.forecast_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forecast_log_select_own" ON public.forecast_log;
DROP POLICY IF EXISTS "forecast_log_insert_own" ON public.forecast_log;
DROP POLICY IF EXISTS "forecast_evaluations_select_own" ON public.forecast_evaluations;
DROP POLICY IF EXISTS "forecast_evaluations_insert_own" ON public.forecast_evaluations;
CREATE POLICY "forecast_log_select_own" ON public.forecast_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "forecast_log_insert_own" ON public.forecast_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "forecast_evaluations_select_own" ON public.forecast_evaluations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "forecast_evaluations_insert_own" ON public.forecast_evaluations FOR INSERT WITH CHECK (auth.uid() = user_id);
