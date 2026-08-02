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
