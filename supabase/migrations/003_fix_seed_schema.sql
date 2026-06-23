-- Fix schema mismatches between migrations and seed script

-- job_descriptions: seed uses string IDs like "se-fe-001"
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_jd_id_fkey;
ALTER TABLE job_descriptions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE job_descriptions ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE sessions ALTER COLUMN jd_id TYPE TEXT USING jd_id::text;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_jd_id_fkey
  FOREIGN KEY (jd_id) REFERENCES job_descriptions(id) ON DELETE SET NULL;

ALTER TABLE job_descriptions ADD COLUMN IF NOT EXISTS seniority TEXT;

-- company_culture_profiles: seed data uses plain strings, not arrays
ALTER TABLE company_culture_profiles
  ALTER COLUMN interview_style TYPE TEXT USING
    CASE
      WHEN interview_style IS NULL THEN NULL
      WHEN array_length(interview_style, 1) IS NULL THEN NULL
      ELSE interview_style[1]
    END;

ALTER TABLE company_culture_profiles
  ALTER COLUMN founders_round_focus TYPE TEXT USING
    CASE
      WHEN founders_round_focus IS NULL THEN NULL
      WHEN array_length(founders_round_focus, 1) IS NULL THEN NULL
      ELSE founders_round_focus[1]
    END;

-- badges: seed data includes category and rarity
ALTER TABLE badges
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS rarity TEXT;
