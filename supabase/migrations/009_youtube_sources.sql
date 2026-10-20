-- Phase 6 (docs/VISION_PLAN.md): YouTube as another source type (captions only), and playlists as groups of sources.
-- A YouTube source has kind 'youtube', storage_path 'youtube:<videoId>' (no file is stored), source_url set, and its
-- sections located by timestamp ({t} / {tStart,tEnd}, in seconds). Additive except the widened kind check.

CREATE TABLE IF NOT EXISTS public.source_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
    url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.source_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "source_groups_select_own" ON public.source_groups;
DROP POLICY IF EXISTS "source_groups_insert_own" ON public.source_groups;
DROP POLICY IF EXISTS "source_groups_update_own" ON public.source_groups;
DROP POLICY IF EXISTS "source_groups_delete_own" ON public.source_groups;
CREATE POLICY "source_groups_select_own" ON public.source_groups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "source_groups_insert_own" ON public.source_groups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "source_groups_update_own" ON public.source_groups FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "source_groups_delete_own" ON public.source_groups FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.source_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sources_group ON public.sources (group_id) WHERE group_id IS NOT NULL;

-- A source may only be placed in one of the user's own groups (same hardening as 006/007).
ALTER POLICY "sources_insert_own" ON public.sources
    WITH CHECK (auth.uid() = user_id AND (group_id IS NULL OR EXISTS (SELECT 1 FROM public.source_groups g WHERE g.id = group_id AND g.user_id = auth.uid())));
ALTER POLICY "sources_update_own" ON public.sources
    WITH CHECK (auth.uid() = user_id AND (group_id IS NULL OR EXISTS (SELECT 1 FROM public.source_groups g WHERE g.id = group_id AND g.user_id = auth.uid())));

ALTER TABLE public.sources DROP CONSTRAINT IF EXISTS sources_kind_check;
ALTER TABLE public.sources ADD CONSTRAINT sources_kind_check CHECK (kind IN ('pdf', 'pptx', 'docx', 'text', 'youtube'));
