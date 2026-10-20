-- B7: profile settings + demo flag.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS daily_goal INTEGER NOT NULL DEFAULT 20 CHECK (daily_goal BETWEEN 1 AND 500);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS target_recall REAL NOT NULL DEFAULT 0.8 CHECK (target_recall BETWEEN 0.5 AND 0.99);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- Users may update their own profile row, but must not be able to flip is_demo.
CREATE OR REPLACE FUNCTION public.protect_is_demo() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.is_demo IS DISTINCT FROM OLD.is_demo AND COALESCE(auth.role(), '') <> 'service_role' THEN
        NEW.is_demo := OLD.is_demo;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_protect_is_demo ON public.profiles;
CREATE TRIGGER profiles_protect_is_demo BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_is_demo();
REVOKE ALL ON FUNCTION public.protect_is_demo() FROM PUBLIC, anon, authenticated;
