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
