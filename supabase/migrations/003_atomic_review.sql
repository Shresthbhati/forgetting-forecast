-- B2: atomic + idempotent review submission, and the history index (B4).

ALTER TABLE public.retrieval_attempts ADD COLUMN IF NOT EXISTS client_request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_retrieval_attempts_client_request
    ON public.retrieval_attempts (user_id, client_request_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_attempts_user_answered
    ON public.retrieval_attempts (user_id, answered_at DESC);

-- Inserts the attempt and upserts the recall state in ONE transaction. SECURITY INVOKER: RLS applies.
-- A repeated client_request_id returns the original attempt and current state and writes nothing.
CREATE OR REPLACE FUNCTION public.submit_review_tx(p_attempt JSONB, p_state JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_concept UUID := (p_attempt->>'concept_id')::UUID;
    v_attempt public.retrieval_attempts;
    v_state public.recall_states;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.concepts WHERE id = v_concept AND user_id = v_uid) THEN
        RAISE EXCEPTION 'Concept not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.retrieval_attempts (
        user_id, concept_id, session_id, presented_at, answered_at, elapsed_since_previous_review_hours,
        predicted_recall_probability, actual_correctness, self_reported_confidence, response_latency_ms,
        model_version, scheduler_version, review_mode, metadata, client_request_id)
    VALUES (
        v_uid, v_concept, NULLIF(p_attempt->>'session_id','')::UUID,
        (p_attempt->>'presented_at')::TIMESTAMPTZ, (p_attempt->>'answered_at')::TIMESTAMPTZ,
        NULLIF(p_attempt->>'elapsed_since_previous_review_hours','')::REAL,
        (p_attempt->>'predicted_recall_probability')::REAL, (p_attempt->>'actual_correctness')::BOOLEAN,
        NULLIF(p_attempt->>'self_reported_confidence','')::REAL, (p_attempt->>'response_latency_ms')::INTEGER,
        p_attempt->>'model_version', p_attempt->>'scheduler_version', p_attempt->>'review_mode',
        p_attempt->'metadata', NULLIF(p_attempt->>'client_request_id','')::UUID)
    ON CONFLICT (user_id, client_request_id) DO NOTHING
    RETURNING * INTO v_attempt;

    IF v_attempt.id IS NULL THEN
        SELECT * INTO v_attempt FROM public.retrieval_attempts
         WHERE user_id = v_uid AND client_request_id = (p_attempt->>'client_request_id')::UUID;
        SELECT * INTO v_state FROM public.recall_states WHERE concept_id = v_concept AND user_id = v_uid;
        RETURN jsonb_build_object('attempt', to_jsonb(v_attempt), 'state', to_jsonb(v_state), 'duplicate', true);
    END IF;

    INSERT INTO public.recall_states (
        concept_id, user_id, model_version, estimated_half_life_hours, repetition_count,
        successful_recall_count, lapse_count, last_reviewed_at, next_review_at, last_predicted_recall_probability)
    VALUES (
        v_concept, v_uid, p_state->>'model_version', (p_state->>'estimated_half_life_hours')::REAL,
        (p_state->>'repetition_count')::INTEGER, (p_state->>'successful_recall_count')::INTEGER,
        (p_state->>'lapse_count')::INTEGER, (p_state->>'last_reviewed_at')::TIMESTAMPTZ,
        (p_state->>'next_review_at')::TIMESTAMPTZ, (p_state->>'last_predicted_recall_probability')::REAL)
    ON CONFLICT (concept_id) DO UPDATE SET
        model_version = EXCLUDED.model_version,
        estimated_half_life_hours = EXCLUDED.estimated_half_life_hours,
        repetition_count = EXCLUDED.repetition_count,
        successful_recall_count = EXCLUDED.successful_recall_count,
        lapse_count = EXCLUDED.lapse_count,
        last_reviewed_at = EXCLUDED.last_reviewed_at,
        next_review_at = EXCLUDED.next_review_at,
        last_predicted_recall_probability = EXCLUDED.last_predicted_recall_probability,
        updated_at = NOW()
    RETURNING * INTO v_state;

    RETURN jsonb_build_object('attempt', to_jsonb(v_attempt), 'state', to_jsonb(v_state), 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review_tx(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review_tx(jsonb, jsonb) TO authenticated;
