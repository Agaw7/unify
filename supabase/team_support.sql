
-- UNIFY: TEAM DATABASE SUPPORT

-- 1. Add invitation columns
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS invite_code TEXT,
ADD COLUMN IF NOT EXISTS invited_by UUID
REFERENCES public.profiles(id);

-- 2. Generate unique invitation codes
UPDATE public.profiles
SET invite_code = encode(gen_random_bytes(12), 'hex')
WHERE invite_code IS NULL;

ALTER TABLE public.profiles
ALTER COLUMN invite_code
SET DEFAULT encode(gen_random_bytes(12), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS
profiles_invite_code_unique
ON public.profiles(invite_code);

-- 3. Create Team members view
CREATE OR REPLACE VIEW public.team_members
WITH (security_invoker = true)
AS
SELECT
  id,
  full_name,
  invited_by,
  created_at
FROM public.profiles;

-- 4. Allow users to view their invited members
DROP POLICY IF EXISTS "Read invited profiles"
ON public.profiles;

CREATE POLICY "Read invited profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (invited_by = (SELECT auth.uid()));

GRANT SELECT ON public.team_members TO authenticated;
