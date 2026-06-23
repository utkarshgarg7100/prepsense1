-- ─── Additional tables required by the seed script ──────────────────────────

-- Company culture profiles (richer than the JD company_name field)
CREATE TABLE IF NOT EXISTS company_culture_profiles (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  tier                  company_tier,
  industry              TEXT,
  founded               TEXT,
  hq                    TEXT,
  size                  TEXT,
  culture_values        TEXT[],
  interview_style       TEXT[],
  what_they_look_for    TEXT[],
  red_flags_for_them    TEXT[],
  hr_round_focus        TEXT[],
  sample_hr_questions   TEXT[],
  founders_round_focus  TEXT[],
  key_products          TEXT[],
  competitors           TEXT[],
  recent_news_to_know   TEXT[]
);

-- Static question bank (pre-written questions to supplement AI generation)
CREATE TABLE IF NOT EXISTS question_bank (
  id                    TEXT PRIMARY KEY,
  role_type             TEXT,
  role_subtype          TEXT,
  round_type            TEXT NOT NULL,
  question_text         TEXT NOT NULL,
  tags                  TEXT[],
  follow_up_triggers    TEXT[],
  ideal_length_words    TEXT,
  strong_answer_signals TEXT[],
  is_sample             BOOLEAN DEFAULT TRUE
);

-- Generic key-value app config store
CREATE TABLE IF NOT EXISTS app_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns to badges that the seed data includes but the original schema lacks
ALTER TABLE badges
  ADD COLUMN IF NOT EXISTS condition_metric TEXT,
  ADD COLUMN IF NOT EXISTS condition_count  INTEGER;
