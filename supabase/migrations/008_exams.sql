-- Phase 5 (docs/VISION_PLAN.md): exam dates. The revision plan and syllabus coverage are computed from the user's
-- sources and concepts; only the exam itself is stored. Additive only.

CREATE TABLE IF NOT EXISTS public.exams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 100),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    exam_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exams_user_date ON public.exams (user_id, exam_date);

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exams_select_own" ON public.exams;
DROP POLICY IF EXISTS "exams_insert_own" ON public.exams;
DROP POLICY IF EXISTS "exams_update_own" ON public.exams;
DROP POLICY IF EXISTS "exams_delete_own" ON public.exams;
CREATE POLICY "exams_select_own" ON public.exams FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "exams_insert_own" ON public.exams FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "exams_update_own" ON public.exams FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "exams_delete_own" ON public.exams FOR DELETE USING (auth.uid() = user_id);
