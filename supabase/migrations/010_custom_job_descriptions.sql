-- 010: user-supplied job descriptions
--
-- Custom JDs live in `job_descriptions` alongside the seeded ones rather than in a
-- separate table. The whole app already joins on this table — sessions.jd_id, the
-- percentile function, the report — and a second table would mean teaching every one
-- of those about two sources of truth. A seeded JD is `user_id IS NULL`; a custom one
-- carries its owner.

ALTER TABLE job_descriptions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS jd_user_id_idx ON job_descriptions(user_id);

COMMENT ON COLUMN job_descriptions.user_id IS
  'NULL for seeded/public JDs. Set to the owner for user-pasted or uploaded JDs, which are private to that user.';

-- A pasted JD is usually from a company that fits none of the four seeded tiers.
-- Forcing one would put a false signal into the interviewer prompt, which reads tier.
ALTER TYPE company_tier ADD VALUE IF NOT EXISTS 'Other';

-- ─── RLS ──────────────────────────────────────────────────────────────────
--
-- The existing SELECT policy is USING (TRUE) — with custom rows in this table that
-- would show every user everyone else's uploaded JDs. It must be replaced, not added to:
-- Postgres ORs multiple permissive policies together, so leaving the old one in place
-- would keep the leak open.

DROP POLICY IF EXISTS "Anyone can read job descriptions" ON job_descriptions;
DROP POLICY IF EXISTS "Only service role can insert JDs" ON job_descriptions;

CREATE POLICY "Read seeded JDs and own custom JDs" ON job_descriptions
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Insert own custom JDs" ON job_descriptions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "Update own custom JDs" ON job_descriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Delete own custom JDs" ON job_descriptions
  FOR DELETE USING (auth.uid() = user_id);

-- Seeding still works: the service role bypasses RLS entirely, so `scripts/seed.ts`
-- is unaffected by the insert policy tightening above.
