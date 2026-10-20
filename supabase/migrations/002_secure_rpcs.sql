-- B1: close the cross-user leak. The old RPCs were SECURITY DEFINER and trusted a caller-supplied
-- p_user_id, and PUBLIC/anon could execute them. New versions read auth.uid() and run as the caller (RLS applies).

DROP FUNCTION IF EXISTS public.get_due_concepts(uuid, integer, text, text, integer);
DROP FUNCTION IF EXISTS public.get_dashboard_summary(uuid);

CREATE OR REPLACE FUNCTION public.get_due_concepts(
    p_limit INTEGER DEFAULT 20,
    p_mode TEXT DEFAULT 'due',
    p_subject TEXT DEFAULT NULL,
    p_forecast_horizon_hours INTEGER DEFAULT 168
)
RETURNS TABLE (
    concept_id UUID, subject TEXT, topic TEXT, prompt TEXT, answer TEXT, explanation TEXT,
    difficulty INTEGER, tags TEXT[], created_at TIMESTAMPTZ,
    estimated_half_life_hours REAL, repetition_count INTEGER, successful_recall_count INTEGER,
    lapse_count INTEGER, last_reviewed_at TIMESTAMPTZ, next_review_at TIMESTAMPTZ,
    last_predicted_recall_probability REAL
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.subject, c.topic, c.prompt, c.answer, c.explanation, c.difficulty, c.tags, c.created_at,
           rs.estimated_half_life_hours, rs.repetition_count, rs.successful_recall_count, rs.lapse_count,
           rs.last_reviewed_at, rs.next_review_at, rs.last_predicted_recall_probability
    FROM public.concepts c
    JOIN public.recall_states rs ON rs.concept_id = c.id
    WHERE c.user_id = auth.uid()
      AND c.archived_at IS NULL
      AND rs.user_id = auth.uid()
      AND (
          p_mode = 'due' AND rs.next_review_at IS NOT NULL AND rs.next_review_at <= NOW()
          OR p_mode = 'practice'
          OR p_mode = 'experiment'
      )
      AND (p_subject IS NULL OR c.subject = p_subject)
    ORDER BY
        CASE WHEN rs.next_review_at IS NOT NULL AND rs.next_review_at <= NOW() THEN 0
             WHEN rs.next_review_at IS NOT NULL THEN 1 ELSE 2 END,
        rs.last_predicted_recall_probability ASC NULLS FIRST,
        rs.next_review_at ASC NULLS LAST
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS TABLE (
    total_active_concepts BIGINT, due_concepts BIGINT, reviews_completed_today BIGINT,
    reviews_completed_this_week BIGINT, mean_estimated_recall REAL
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM public.concepts WHERE user_id = auth.uid() AND archived_at IS NULL)::BIGINT,
        (SELECT COUNT(*) FROM public.recall_states rs
          JOIN public.concepts c ON c.id = rs.concept_id
          WHERE rs.user_id = auth.uid() AND c.archived_at IS NULL
            AND rs.next_review_at IS NOT NULL AND rs.next_review_at <= NOW())::BIGINT,
        (SELECT COUNT(*) FROM public.retrieval_attempts
          WHERE user_id = auth.uid() AND answered_at >= NOW() - INTERVAL '1 day')::BIGINT,
        (SELECT COUNT(*) FROM public.retrieval_attempts
          WHERE user_id = auth.uid() AND answered_at >= NOW() - INTERVAL '7 days')::BIGINT,
        (SELECT COALESCE(AVG(rs.last_predicted_recall_probability), 0) FROM public.recall_states rs
          JOIN public.concepts c ON c.id = rs.concept_id
          WHERE rs.user_id = auth.uid() AND c.archived_at IS NULL
            AND rs.last_predicted_recall_probability IS NOT NULL)::REAL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_due_concepts(integer, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_due_concepts(integer, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary() TO authenticated;

-- Trigger functions must never be callable as RPCs.
ALTER FUNCTION public.handle_new_user() SET search_path = public;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
