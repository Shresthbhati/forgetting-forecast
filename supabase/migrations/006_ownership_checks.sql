-- Hardening: INSERT policies only checked user_id, so a user who learned another user's concept id could attach
-- rows to it. Require that the referenced concept belongs to the inserting user.

DROP POLICY IF EXISTS "recall_states_insert_own" ON public.recall_states;
CREATE POLICY "recall_states_insert_own" ON public.recall_states FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (SELECT 1 FROM public.concepts c WHERE c.id = concept_id AND c.user_id = auth.uid())
    );

DROP POLICY IF EXISTS "retrieval_attempts_insert_own" ON public.retrieval_attempts;
CREATE POLICY "retrieval_attempts_insert_own" ON public.retrieval_attempts FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (SELECT 1 FROM public.concepts c WHERE c.id = concept_id AND c.user_id = auth.uid())
    );

DROP POLICY IF EXISTS "forecast_log_insert_own" ON public.forecast_log;
CREATE POLICY "forecast_log_insert_own" ON public.forecast_log FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (SELECT 1 FROM public.concepts c WHERE c.id = concept_id AND c.user_id = auth.uid())
    );
