-- Phase 1 (docs/VISION_PLAN.md): uploaded study material. Additive only.
-- sources -> source_sections -> source_terms, an optional link from concepts back to the passage they came from,
-- a private Storage bucket for the original files, and one atomic RPC that writes a parsed source.

CREATE TABLE IF NOT EXISTS public.sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 100),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
    kind TEXT NOT NULL CHECK (kind IN ('pdf', 'pptx', 'docx', 'text')),
    storage_path TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
    error TEXT,
    unit_count INTEGER CHECK (unit_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Re-uploading the same file is idempotent.
    UNIQUE (user_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_sources_user_subject ON public.sources (user_id, subject, created_at DESC);

CREATE TABLE IF NOT EXISTS public.source_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 6),
    heading TEXT NOT NULL,
    text TEXT NOT NULL,
    -- {page} | {slide} | {pageStart,pageEnd} | {slideStart,slideEnd} | {} for plain text
    location JSONB NOT NULL DEFAULT '{}'::jsonb,
    char_count INTEGER NOT NULL CHECK (char_count >= 0),
    UNIQUE (source_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_source_sections_user ON public.source_sections (user_id);

CREATE TABLE IF NOT EXISTS public.source_terms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
    section_id UUID REFERENCES public.source_sections(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    definition TEXT,
    location JSONB NOT NULL DEFAULT '{}'::jsonb,
    score REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_source_terms_source ON public.source_terms (source_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_source_terms_section ON public.source_terms (section_id);
CREATE INDEX IF NOT EXISTS idx_source_terms_user ON public.source_terms (user_id);

ALTER TABLE public.concepts ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL;
ALTER TABLE public.concepts ADD COLUMN IF NOT EXISTS source_section_id UUID REFERENCES public.source_sections(id) ON DELETE SET NULL;
ALTER TABLE public.concepts ADD COLUMN IF NOT EXISTS source_location JSONB;
CREATE INDEX IF NOT EXISTS idx_concepts_source ON public.concepts (source_id) WHERE source_id IS NOT NULL;

DROP TRIGGER IF EXISTS sources_updated_at ON public.sources;
CREATE TRIGGER sources_updated_at BEFORE UPDATE ON public.sources FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---- Row Level Security: a user reads and changes only their own rows ----
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sources_select_own" ON public.sources;
DROP POLICY IF EXISTS "sources_insert_own" ON public.sources;
DROP POLICY IF EXISTS "sources_update_own" ON public.sources;
DROP POLICY IF EXISTS "sources_delete_own" ON public.sources;
CREATE POLICY "sources_select_own" ON public.sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sources_insert_own" ON public.sources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sources_update_own" ON public.sources FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sources_delete_own" ON public.sources FOR DELETE USING (auth.uid() = user_id);

-- Inserts also require that the parent source belongs to the inserting user (same hardening as 006).
DROP POLICY IF EXISTS "source_sections_select_own" ON public.source_sections;
DROP POLICY IF EXISTS "source_sections_insert_own" ON public.source_sections;
DROP POLICY IF EXISTS "source_sections_delete_own" ON public.source_sections;
CREATE POLICY "source_sections_select_own" ON public.source_sections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "source_sections_insert_own" ON public.source_sections FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (SELECT 1 FROM public.sources s WHERE s.id = source_id AND s.user_id = auth.uid())
    );
CREATE POLICY "source_sections_delete_own" ON public.source_sections FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "source_terms_select_own" ON public.source_terms;
DROP POLICY IF EXISTS "source_terms_insert_own" ON public.source_terms;
DROP POLICY IF EXISTS "source_terms_delete_own" ON public.source_terms;
CREATE POLICY "source_terms_select_own" ON public.source_terms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "source_terms_insert_own" ON public.source_terms FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (SELECT 1 FROM public.sources s WHERE s.id = source_id AND s.user_id = auth.uid())
        AND (section_id IS NULL OR EXISTS (
            SELECT 1 FROM public.source_sections ss WHERE ss.id = section_id AND ss.user_id = auth.uid()))
    );
CREATE POLICY "source_terms_delete_own" ON public.source_terms FOR DELETE USING (auth.uid() = user_id);

-- A concept may only point at the user's own source/section.
DROP POLICY IF EXISTS "concepts_insert_own" ON public.concepts;
CREATE POLICY "concepts_insert_own" ON public.concepts FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND (source_id IS NULL OR EXISTS (SELECT 1 FROM public.sources s WHERE s.id = source_id AND s.user_id = auth.uid()))
        AND (source_section_id IS NULL OR EXISTS (
            SELECT 1 FROM public.source_sections ss WHERE ss.id = source_section_id AND ss.user_id = auth.uid()))
    );
DROP POLICY IF EXISTS "concepts_update_own" ON public.concepts;
CREATE POLICY "concepts_update_own" ON public.concepts FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND (source_id IS NULL OR EXISTS (SELECT 1 FROM public.sources s WHERE s.id = source_id AND s.user_id = auth.uid()))
        AND (source_section_id IS NULL OR EXISTS (
            SELECT 1 FROM public.source_sections ss WHERE ss.id = source_section_id AND ss.user_id = auth.uid()))
    );

-- ---- Atomic write of a parsed source ----
-- Inserts the sections/terms of a freshly uploaded source and flips status to 'ready' in ONE transaction,
-- so a failure never leaves half-written sections (re-ingesting a source that already has sections is refused). Terms reference their section by `section_ordinal`.
-- SECURITY INVOKER: RLS applies to every statement.
CREATE OR REPLACE FUNCTION public.ingest_source_tx(p_source_id UUID, p_unit_count INTEGER, p_sections JSONB, p_terms JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_sections INTEGER;
    v_terms INTEGER;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sources WHERE id = p_source_id AND user_id = v_uid) THEN
        RAISE EXCEPTION 'Source not found' USING ERRCODE = 'P0002';
    END IF;
    IF jsonb_typeof(p_sections) <> 'array' OR jsonb_typeof(p_terms) <> 'array' THEN
        RAISE EXCEPTION 'sections and terms must be arrays' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (SELECT 1 FROM public.source_sections WHERE source_id = p_source_id) THEN
        RAISE EXCEPTION 'Source already ingested' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.source_sections (source_id, user_id, ordinal, level, heading, text, location, char_count)
    SELECT p_source_id, v_uid, (s->>'ordinal')::INTEGER, COALESCE((s->>'level')::INTEGER, 1),
           s->>'heading', s->>'text', COALESCE(s->'location', '{}'::jsonb), char_length(s->>'text')
    FROM jsonb_array_elements(p_sections) AS s;
    GET DIAGNOSTICS v_sections = ROW_COUNT;

    INSERT INTO public.source_terms (source_id, section_id, user_id, term, definition, location, score)
    SELECT p_source_id, ss.id, v_uid, t->>'term', NULLIF(t->>'definition', ''),
           COALESCE(t->'location', '{}'::jsonb), COALESCE((t->>'score')::REAL, 0)
    FROM jsonb_array_elements(p_terms) AS t
    LEFT JOIN public.source_sections ss
           ON ss.source_id = p_source_id AND ss.ordinal = (t->>'section_ordinal')::INTEGER;
    GET DIAGNOSTICS v_terms = ROW_COUNT;

    UPDATE public.sources SET status = 'ready', error = NULL, unit_count = p_unit_count
     WHERE id = p_source_id AND user_id = v_uid;

    RETURN jsonb_build_object('source_id', p_source_id, 'sections', v_sections, 'terms', v_terms);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_source_tx(UUID, INTEGER, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingest_source_tx(UUID, INTEGER, JSONB, JSONB) TO authenticated;

-- ---- Private Storage bucket: files live at {user_id}/{source_id}.{ext} ----
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sources', 'sources', FALSE, 20971520)
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "sources_objects_select_own" ON storage.objects;
DROP POLICY IF EXISTS "sources_objects_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "sources_objects_update_own" ON storage.objects;
DROP POLICY IF EXISTS "sources_objects_delete_own" ON storage.objects;
CREATE POLICY "sources_objects_select_own" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'sources' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "sources_objects_insert_own" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'sources' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "sources_objects_update_own" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'sources' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'sources' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "sources_objects_delete_own" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'sources' AND (storage.foldername(name))[1] = auth.uid()::text);
