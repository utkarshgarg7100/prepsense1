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
