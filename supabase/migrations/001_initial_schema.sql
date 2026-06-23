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
