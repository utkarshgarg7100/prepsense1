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
