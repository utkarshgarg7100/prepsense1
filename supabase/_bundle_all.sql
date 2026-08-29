-- PrepSense full schema: migrations 001-011 concatenated, in order.
-- Paste into Supabase SQL Editor and Run once, on a fresh project.


-- ═══════════════════════════════════════════════════════
-- 001_initial_schema.sql
-- ═══════════════════════════════════════════════════════
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── ENUMS ────────────────────────────────────────────────────────────────

CREATE TYPE experience_level AS ENUM ('fresher', '1-3yr', '3-5yr', '5yr+');
CREATE TYPE company_tier AS ENUM ('FAANG', 'Indian Unicorn', 'Global MNC', 'Series B Startup');
CREATE TYPE role_type AS ENUM (
  'Software Engineering',
  'Product Management',
  'Business & Strategy',
  'Design',
  'Data & Analytics',
  'Operations'
);
CREATE TYPE session_mode AS ENUM ('jd_based', 'general', 'custom');
CREATE TYPE round_type AS ENUM ('technical', 'founders', 'hr');
CREATE TYPE session_status AS ENUM ('in_progress', 'completed', 'abandoned');
CREATE TYPE message_role AS ENUM ('interviewer', 'candidate');
CREATE TYPE marker_type AS ENUM ('vague', 'weak', 'strong', 'unexplored', 'missing_from_jd');

-- ─── PROFILES ─────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  target_roles TEXT[] DEFAULT '{}',
  target_companies TEXT[] DEFAULT '{}',
  experience_level experience_level,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Trigger to create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RESUMES ──────────────────────────────────────────────────────────────

CREATE TABLE resumes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_url TEXT,
  parsed_text TEXT NOT NULL DEFAULT '',
  extracted_skills TEXT[] DEFAULT '{}',
  extracted_experience JSONB DEFAULT '[]',
  extracted_education JSONB DEFAULT '[]',
  extracted_projects JSONB DEFAULT '[]',
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT FALSE,
  is_synthetic BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own resumes" ON resumes FOR ALL USING (auth.uid() = user_id);

-- Ensure only one active resume per user
CREATE UNIQUE INDEX resumes_one_active_per_user ON resumes(user_id) WHERE is_active = TRUE;

-- ─── JOB DESCRIPTIONS ─────────────────────────────────────────────────────

CREATE TABLE job_descriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_type role_type NOT NULL,
  role_subtype TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_tier company_tier NOT NULL,
  industry TEXT NOT NULL,
  jd_text TEXT NOT NULL,
  required_skills TEXT[] DEFAULT '{}',
  nice_to_have_skills TEXT[] DEFAULT '{}',
  culture_tags TEXT[] DEFAULT '{}',
  is_sample BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE job_descriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read job descriptions" ON job_descriptions FOR SELECT USING (TRUE);
CREATE POLICY "Only service role can insert JDs" ON job_descriptions FOR INSERT WITH CHECK (FALSE);

CREATE INDEX jd_role_type_idx ON job_descriptions(role_type);
CREATE INDEX jd_company_tier_idx ON job_descriptions(company_tier);
CREATE INDEX jd_company_name_idx ON job_descriptions(company_name);

-- ─── SESSIONS ─────────────────────────────────────────────────────────────

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
  jd_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
  mode session_mode NOT NULL DEFAULT 'jd_based',
  round_type round_type NOT NULL DEFAULT 'technical',
  status session_status NOT NULL DEFAULT 'in_progress',
  question_plan JSONB,
  gap_matrix JSONB,
  claims_history TEXT[] DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_duration_seconds INTEGER
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sessions" ON sessions FOR ALL USING (auth.uid() = user_id);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_status_idx ON sessions(status);
CREATE INDEX sessions_started_at_idx ON sessions(started_at DESC);

-- ─── MESSAGES ─────────────────────────────────────────────────────────────

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role message_role NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  question_type TEXT,
  question_tags TEXT[] DEFAULT '{}',
  answer_evaluation JSONB
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage messages in own sessions" ON messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM sessions WHERE sessions.id = messages.session_id AND sessions.user_id = auth.uid())
  );

CREATE INDEX messages_session_id_idx ON messages(session_id);
CREATE INDEX messages_timestamp_idx ON messages(timestamp);

-- ─── SESSION SCORES ───────────────────────────────────────────────────────

CREATE TABLE session_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Technical metrics
  technical_depth INTEGER DEFAULT 0 CHECK (technical_depth BETWEEN 0 AND 100),
  problem_decomposition INTEGER DEFAULT 0 CHECK (problem_decomposition BETWEEN 0 AND 100),
  experience_match INTEGER DEFAULT 0 CHECK (experience_match BETWEEN 0 AND 100),
  gap_awareness INTEGER DEFAULT 0 CHECK (gap_awareness BETWEEN 0 AND 100),
  scalability_thinking INTEGER DEFAULT 0 CHECK (scalability_thinking BETWEEN 0 AND 100),
  -- Founders metrics
  business_acumen INTEGER DEFAULT 0 CHECK (business_acumen BETWEEN 0 AND 100),
  first_principles INTEGER DEFAULT 0 CHECK (first_principles BETWEEN 0 AND 100),
  ambiguity_handling INTEGER DEFAULT 0 CHECK (ambiguity_handling BETWEEN 0 AND 100),
  ownership_signals INTEGER DEFAULT 0 CHECK (ownership_signals BETWEEN 0 AND 100),
  communication_clarity INTEGER DEFAULT 0 CHECK (communication_clarity BETWEEN 0 AND 100),
  -- HR metrics
  cultural_alignment INTEGER DEFAULT 0 CHECK (cultural_alignment BETWEEN 0 AND 100),
  self_awareness INTEGER DEFAULT 0 CHECK (self_awareness BETWEEN 0 AND 100),
  conflict_resolution INTEGER DEFAULT 0 CHECK (conflict_resolution BETWEEN 0 AND 100),
  motivation_authenticity INTEGER DEFAULT 0 CHECK (motivation_authenticity BETWEEN 0 AND 100),
  verbal_fluency INTEGER DEFAULT 0 CHECK (verbal_fluency BETWEEN 0 AND 100),
  -- Universal
  star_compliance INTEGER DEFAULT 0 CHECK (star_compliance BETWEEN 0 AND 100),
  answer_conciseness INTEGER DEFAULT 0 CHECK (answer_conciseness BETWEEN 0 AND 100),
  consistency INTEGER DEFAULT 0 CHECK (consistency BETWEEN 0 AND 100),
  -- Aggregates
  overall_score INTEGER DEFAULT 0 CHECK (overall_score BETWEEN 0 AND 100),
  percentile INTEGER DEFAULT 0 CHECK (percentile BETWEEN 0 AND 100),
  custom_metrics JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE session_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scores" ON session_scores FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can insert scores" ON session_scores FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role can update scores" ON session_scores FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX session_scores_user_id_idx ON session_scores(user_id);

-- ─── RESUME MARKERS ───────────────────────────────────────────────────────

CREATE TABLE resume_markers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  resume_line_text TEXT NOT NULL,
  marker_type marker_type NOT NULL,
  suggestion TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE resume_markers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view markers for own sessions" ON resume_markers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM sessions WHERE sessions.id = resume_markers.session_id AND sessions.user_id = auth.uid())
  );

-- ─── SPEECH FEEDBACK ──────────────────────────────────────────────────────

CREATE TABLE speech_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  filler_word_count INTEGER DEFAULT 0,
  filler_words JSONB DEFAULT '{}',
  avg_answer_length_seconds INTEGER DEFAULT 0,
  ideal_range_min INTEGER DEFAULT 60,
  ideal_range_max INTEGER DEFAULT 120,
  deflection_count INTEGER DEFAULT 0,
  hedging_count INTEGER DEFAULT 0,
  pace_assessment TEXT DEFAULT ''
);

ALTER TABLE speech_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view speech feedback for own sessions" ON speech_feedback
  FOR ALL USING (
    EXISTS (SELECT 1 FROM sessions WHERE sessions.id = speech_feedback.session_id AND sessions.user_id = auth.uid())
  );

-- ─── QUESTION PERFORMANCE ─────────────────────────────────────────────────

CREATE TABLE question_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  question_tags TEXT[] DEFAULT '{}',
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE question_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own question performance" ON question_performance FOR ALL USING (auth.uid() = user_id);

CREATE INDEX qp_user_id_idx ON question_performance(user_id);
CREATE INDEX qp_tags_idx ON question_performance USING GIN(question_tags);

-- ─── USER WEAK AREAS (RL Bandit State) ───────────────────────────────────

CREATE TABLE user_weak_areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  avg_score FLOAT DEFAULT 50.0,
  session_count INTEGER DEFAULT 0,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Thompson Sampling Beta distribution params
  alpha FLOAT DEFAULT 1.0,
  beta FLOAT DEFAULT 1.0,
  UNIQUE(user_id, tag)
);

ALTER TABLE user_weak_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own weak areas" ON user_weak_areas FOR ALL USING (auth.uid() = user_id);

CREATE TRIGGER user_weak_areas_updated_at BEFORE UPDATE ON user_weak_areas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── BADGES ───────────────────────────────────────────────────────────────

CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  condition_type TEXT NOT NULL,
  condition_value INTEGER NOT NULL
);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view badges" ON badges FOR SELECT USING (TRUE);

-- ─── USER ACHIEVEMENTS ────────────────────────────────────────────────────

CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL REFERENCES badges(id),
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own achievements" ON user_achievements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can insert achievements" ON user_achievements FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ─── USER STREAKS ─────────────────────────────────────────────────────────

CREATE TABLE user_streaks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_session_date DATE
);

ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own streaks" ON user_streaks FOR ALL USING (auth.uid() = user_id);

-- ─── SEED BADGES ──────────────────────────────────────────────────────────

INSERT INTO badges (id, name, description, icon, condition_type, condition_value) VALUES
  ('first_shot', 'First Shot', 'Complete your first interview session', '🎯', 'sessions_completed', 1),
  ('on_fire', 'On Fire', 'Maintain a 3-day practice streak', '🔥', 'current_streak', 3),
  ('consistent', 'Consistent', 'Maintain a 7-day practice streak', '💪', 'current_streak', 7),
  ('deep_thinker', 'Deep Thinker', 'Score 80+ on Technical Depth three times', '🧠', 'technical_depth_80_count', 3),
  ('data_driven', 'Data Driven', 'Mention metrics in 5 consecutive answers', '📊', 'consecutive_metric_answers', 5),
  ('smooth_talker', 'Smooth Talker', 'Achieve under 2% filler word rate in a session', '🎤', 'filler_rate_under_2', 1),
  ('top_10_percent', 'Top 10%', 'Reach the 90th percentile in any role', '🏆', 'percentile', 90),
  ('comeback', 'Comeback', 'Improve your score by 20+ points from previous session', '🔄', 'score_improvement', 20),
  ('all_rounder', 'All-Rounder', 'Complete all three round types', '🌟', 'round_types_completed', 3),
  ('resume_pro', 'Resume Pro', 'Earn 5+ green markers on your resume in one session', '📝', 'green_markers', 5),
  ('role_master', 'Role Master', 'Complete 10 sessions for one specific role', '🎓', 'role_sessions', 10),
  ('mock_offer', 'Mock Offer', 'Score 85+ overall in a full 3-round sequence', '💼', 'mock_offer_score', 85);

-- ─── AGGREGATE FUNCTION FOR PERCENTILE ───────────────────────────────────

CREATE OR REPLACE FUNCTION compute_percentile(p_user_id UUID, p_role_type TEXT, p_score INTEGER)
RETURNS INTEGER AS $$
DECLARE
  total_count INTEGER;
  below_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count
  FROM session_scores ss
  JOIN sessions s ON s.id = ss.session_id
  JOIN job_descriptions jd ON jd.id = s.jd_id
  WHERE jd.role_type::TEXT = p_role_type;

  IF total_count = 0 THEN
    RETURN 50;
  END IF;

  SELECT COUNT(*) INTO below_count
  FROM session_scores ss
  JOIN sessions s ON s.id = ss.session_id
  JOIN job_descriptions jd ON jd.id = s.jd_id
  WHERE jd.role_type::TEXT = p_role_type AND ss.overall_score < p_score;

  RETURN ROUND((below_count::FLOAT / total_count::FLOAT) * 100)::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════
-- 002_seed_tables.sql
-- ═══════════════════════════════════════════════════════
-- ─── Additional tables required by the seed script ──────────────────────────

-- Company culture profiles (richer than the JD company_name field)
CREATE TABLE IF NOT EXISTS company_culture_profiles (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  tier                  company_tier,
  industry              TEXT,
  founded               TEXT,  -- year founded, e.g. "2014"
  hq                    TEXT,  -- headquarters city
  size                  TEXT,  -- employee count range e.g. "5000-10000"
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

-- Add file_name to resumes (original schema omitted it)
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '';

-- Add columns to badges that the seed data includes but the original schema lacks
ALTER TABLE badges
  ADD COLUMN IF NOT EXISTS condition_metric TEXT,
  ADD COLUMN IF NOT EXISTS condition_count  INTEGER;


-- ═══════════════════════════════════════════════════════
-- 003_fix_seed_schema.sql
-- ═══════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════
-- 004_test_helpers_and_fixes.sql
-- ═══════════════════════════════════════════════════════
-- ─── Missing columns ───────────────────────────────────────────────────────

-- Add file_name to resumes (if 002 was never run)
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '';

-- Add total_sessions to user_streaks
ALTER TABLE user_streaks ADD COLUMN IF NOT EXISTS total_sessions INTEGER DEFAULT 0;

-- ─── Test helper functions (SECURITY DEFINER = service role can bypass RLS) ──

-- Creates a minimal auth.users row for testing (no email is sent)
CREATE OR REPLACE FUNCTION create_test_auth_user(
  p_id   UUID,
  p_email TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_user_meta_data,
    raw_app_meta_data,
    aud,
    role
  ) VALUES (
    p_id,
    '00000000-0000-0000-0000-000000000000',
    p_email,
    crypt('Test@12345', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    '{"full_name": "PrepSense Tester"}'::jsonb,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    'authenticated',
    'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- Deletes the test auth user (cascades to all user data via FK constraints)
CREATE OR REPLACE FUNCTION delete_test_auth_user(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = p_id;
END;
$$;


-- ═══════════════════════════════════════════════════════
-- 005_fix_trigger.sql
-- ═══════════════════════════════════════════════════════
-- Make handle_new_user resilient — if profile insert fails for any reason,
-- don't block the user creation (they can be onboarded/repaired later).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════
-- 006_answer_duration.sql
-- ═══════════════════════════════════════════════════════
-- Record how long the candidate actually took to answer each question.
--
-- The interview UI has always displayed a live per-answer timer, but the value was
-- never sent to the server. As a result `complete/route.ts` estimated speaking time
-- from word count (words x 0.4s), which meant the "pace" feedback in the report was
-- really an answer-*length* assessment wearing a speaking-*speed* label.
--
-- This column also supplies the "average time-to-answer" feature that the RL
-- curriculum controller's state vector needs, so it is required for Model 1 too.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS time_taken_seconds INTEGER;

COMMENT ON COLUMN messages.time_taken_seconds IS
  'Seconds the candidate spent answering. NULL for interviewer messages and for '
  'candidate answers recorded before this column existed.';


-- ═══════════════════════════════════════════════════════
-- 007_knowledge_state.sql
-- ═══════════════════════════════════════════════════════
-- Persistent per-topic mastery: the "scorecard" (Model 2).
--
-- This is the table that makes PrepSense different from an LLM wrapper. Everything
-- else in the schema is scoped to a single session; this is deliberately scoped to
-- the *user*, so answering well on leadership in March still counts in April. It is
-- also the RL curriculum controller's observation vector, read on every question.
--
-- Note the number: migration 006 is `answer_duration`. Earlier planning documents
-- referred to this file as 006.

CREATE TABLE IF NOT EXISTS knowledge_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  -- P(the candidate has mastered this topic). Bounded because BKT is a probability
  -- and every consumer assumes it: a value outside [0,1] would corrupt the policy's
  -- observation vector without raising anywhere near the cause.
  --
  -- DOUBLE PRECISION, not REAL. REAL is single-precision (~7 significant digits) and
  -- quantises mastery on every write, so the value the policy observes in production
  -- would differ from the one the simulator produced in training. See migration 008,
  -- which fixes databases created before this line changed.
  mastery DOUBLE PRECISION NOT NULL DEFAULT 0.25 CHECK (mastery >= 0 AND mastery <= 1),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Where the starting value came from, so a prior seeded by the resume parser can
  -- be told apart from one the candidate actually earned. Without this, a low
  -- mastery from a thin CV is indistinguishable from a low mastery from bad answers.
  seeded_from TEXT NOT NULL DEFAULT 'default'
    CHECK (seeded_from IN ('default', 'parser', 'observed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (user, topic). Also the conflict target for the upsert the answer
-- route performs after every answer.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_state_user_topic_idx
  ON knowledge_state(user_id, topic);

ALTER TABLE knowledge_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own knowledge state" ON knowledge_state;
CREATE POLICY "Users can manage own knowledge state" ON knowledge_state
  FOR ALL USING (auth.uid() = user_id);

COMMENT ON TABLE knowledge_state IS
  'Per-user, per-topic BKT mastery. Persists across sessions; seeded from the '
  'resume/JD parser (Model 5) and updated after each answer by lib/kt/bkt.ts.';


-- ═══════════════════════════════════════════════════════
-- 008_mastery_precision.sql
-- ═══════════════════════════════════════════════════════
-- Widen knowledge_state.mastery from REAL to DOUBLE PRECISION.
--
-- REAL is single-precision: roughly 7 significant digits. Writing a BKT posterior of
-- 0.414038818359375 and reading back 0.414039 is a silent 1e-7 error on every
-- persisted update.
--
-- That is small, but it lands in exactly the wrong place. `ml/test_bkt_parity.py`
-- pins the Python and TypeScript implementations to 1e-12 precisely because the RL
-- policy trains against the Python student model and runs against the TypeScript
-- one. Quantising the state between those two makes the parity guarantee unenforceable
-- past the seventh digit, and the error compounds across a session because each
-- update is a function of the previous stored value.
--
-- Caught by scripts/test-knowledge-state.ts, which asserted that answering one topic
-- leaves the others bit-identical and found they had shifted.
--
-- Migration 007 now creates the column as DOUBLE PRECISION directly; this file only
-- exists for databases created before that change. It is safe to run either way.

ALTER TABLE knowledge_state
  ALTER COLUMN mastery TYPE DOUBLE PRECISION;

COMMENT ON COLUMN knowledge_state.mastery IS
  'P(topic mastered), maintained by BKT (lib/kt/bkt.ts). DOUBLE PRECISION so the '
  'stored value matches the simulator the RL policy was trained against.';


-- ═══════════════════════════════════════════════════════
-- 009_rl_experience.sql
-- ═══════════════════════════════════════════════════════
-- Transitions logged from live interviews: the RL controller's experience buffer.
--
-- Model 1 was trained entirely against the simulated student (`ml/student_sim.py`),
-- because PPO needs 10^4-10^5 episodes and real usage yields perhaps fifty. This table
-- exists so that gap can start to close, and so the deployed policy can be *audited*
-- rather than merely trusted.
--
-- **What it is honestly for, in this project's timeline.** Not online learning: fifty
-- episodes cannot fine-tune a policy, and pretending otherwise would be the kind of
-- claim a viva takes apart. It is for two things that are achievable:
--
--   1. **Checking the simulator against reality.** If real candidates' score
--      trajectories look nothing like the simulated ones, the central claim rests on a
--      fiction, and this is the only data that could reveal it.
--   2. **Attributing behaviour.** `source` records which fallback layer chose, so a
--      complaint that "the questions were repetitive" can be traced to the policy, the
--      bandit, or the LLM, instead of guessed at.
--
-- Off-policy evaluation on enough logged sessions is the natural follow-up, and the
-- schema is shaped for it - hence storing the full observation rather than a summary.

CREATE TABLE IF NOT EXISTS rl_experience (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- Position within the interview. With session_id this orders the trajectory, which
  -- is what makes the rows a sequence rather than a bag of independent decisions.
  step INTEGER NOT NULL CHECK (step >= 0),

  -- The full 35-float observation as the policy saw it, stored verbatim.
  --
  -- Deliberately not decomposed into columns. Any future analysis has to reconstruct
  -- exactly what the network was fed, and a summary cannot do that - while the feature
  -- layout is versioned by `policy`, so a later retrain with different features stays
  -- interpretable instead of quietly mixing two meanings of "column 31".
  observation DOUBLE PRECISION[] NOT NULL,

  -- The action, stored both ways on purpose: the integer is what an off-policy
  -- evaluator needs, the strings are what a human reading this table needs.
  action INTEGER,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),

  -- Which layer of the fallback chain actually chose. Rows where this is not 'policy'
  -- are off-policy data and must not be treated as the policy's own behaviour.
  source TEXT NOT NULL CHECK (source IN ('policy', 'thompson', 'llm')),
  -- e.g. 'ppo_v6_seed0'. Null when a fallback chose. Without this, rows from two
  -- different trained policies are indistinguishable after a retrain.
  policy TEXT,

  -- The rubric score for the answer this question drew, 0-100. Null until answered,
  -- which is why it is written on the *following* request rather than at insert time.
  score DOUBLE PRECISION CHECK (score >= 0 AND score <= 100),
  -- Change in the system's believed mastery for `topic`, from this answer.
  --
  -- **Not the training reward, and the difference matters.** Training rewarded the
  -- simulated student's *true* mastery gain, which no deployed system can observe. This
  -- is the observable proxy: what the belief did. Recorded under a distinct name so the
  -- two are never silently compared.
  belief_delta DOUBLE PRECISION,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trajectory reconstruction is the only access pattern that matters here.
CREATE INDEX IF NOT EXISTS rl_experience_session_step_idx
  ON rl_experience(session_id, step);

ALTER TABLE rl_experience ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own rl experience" ON rl_experience;
CREATE POLICY "Users can manage own rl experience" ON rl_experience
  FOR ALL USING (auth.uid() = user_id);

COMMENT ON TABLE rl_experience IS
  'One row per question chosen by the curriculum controller (Model 1). Used to audit '
  'which fallback layer chose, and to compare real trajectories against the simulator '
  'the policy was trained on. Not used for online learning.';


-- ═══════════════════════════════════════════════════════
-- 010_custom_job_descriptions.sql
-- ═══════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════
-- 011_knowledge_history.sql
-- ═══════════════════════════════════════════════════════
-- 011: mastery over time
--
-- `knowledge_state` holds one row per (user, topic) and is overwritten on every answer,
-- so the *current* belief is queryable but its trajectory is not. Phase 6's dashboard
-- asks for mastery over time, and the project's central claim — that the system
-- accumulates a picture of the candidate across sessions — is a claim about a curve,
-- not a snapshot.
--
-- Why not reconstruct it from what already exists:
--   - `messages` would require replaying BKT over every answer to rebuild each posterior,
--     which puts a second implementation of the update rule in the read path. The parity
--     tests exist precisely to stop BKT living in more places than necessary.
--   - `rl_experience.observation` does contain mastery, but only for questions the
--     controller chose, only since Phase 5, and only at a column offset that is versioned
--     by `policy`. A user-facing chart should not depend on a feature layout that is
--     expected to change when the policy is retrained.
--
-- So: an append-only log, written beside the upsert that already happens.

CREATE TABLE IF NOT EXISTS knowledge_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,

  -- The posterior *after* this update. DOUBLE PRECISION for the same reason
  -- migration 008 widened `knowledge_state.mastery`: single precision quantises the
  -- value, and here the error would show up as a visibly jagged trend line.
  mastery DOUBLE PRECISION NOT NULL CHECK (mastery >= 0 AND mastery <= 1),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),

  -- The rubric score that caused the move, so a dip in the curve can be explained
  -- rather than merely displayed. Null for seeded priors, which no answer produced.
  score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),

  -- Which session this happened in. ON DELETE SET NULL rather than CASCADE: deleting an
  -- interview should not silently rewrite the candidate's learning history, because the
  -- mastery that session earned is still what the scorecard believes today.
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,

  -- 'parser' rows are the starting guess from the CV, not evidence. Charting them as
  -- learning would show a candidate "improving" before answering a single question.
  source TEXT NOT NULL DEFAULT 'observed'
    CHECK (source IN ('parser', 'observed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The dashboard query: one user's trajectory, oldest first.
CREATE INDEX IF NOT EXISTS knowledge_history_user_time_idx
  ON knowledge_history(user_id, created_at);

-- Per-topic drill-down.
CREATE INDEX IF NOT EXISTS knowledge_history_user_topic_time_idx
  ON knowledge_history(user_id, topic, created_at);

ALTER TABLE knowledge_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own knowledge history" ON knowledge_history;
CREATE POLICY "Users can manage own knowledge history" ON knowledge_history
  FOR ALL USING (auth.uid() = user_id);

COMMENT ON TABLE knowledge_history IS
  'Append-only log of every change to knowledge_state. Written by lib/kt/store.ts '
  'alongside the upsert. Read by the Phase 6 knowledge map; also the record that lets '
  'real learning trajectories be compared against the simulated ones PPO trained on.';

