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
