/**
 * Logging live decisions to `rl_experience` (migration 009).
 *
 * Same contract as `lib/kt/store.ts`: **every function degrades rather than throws.**
 * This is instrumentation. Losing a row costs one data point for later analysis; an
 * exception here would cost a candidate their interview, which is not a trade any
 * amount of research data justifies.
 *
 * The observation is rebuilt here rather than passed down from the chooser so the row
 * records what the *policy* was given, byte for byte, and not a reconstruction made
 * later from state that has since moved on.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TOPICS } from '@/lib/kt/bkt'
import type { Choice, ChoiceState } from '@/lib/ai/chooser'

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST002'])

let missingTableWarned = false
function warnMissing(): void {
  if (missingTableWarned) return
  missingTableWarned = true
  console.warn(
    'rl_experience table not found — apply supabase/migrations/009_rl_experience.sql. ' +
    'Interviews still work; controller decisions are not being logged.'
  )
}

/**
 * The observation exactly as `ml/serve.py` builds it: 15 mastery, 15 attempts, then
 * recent-3, progress, failure streak, last-5, session mean.
 *
 * **This is a third copy of that layout** (Python env, Python service, here) and the
 * duplication is a real cost, accepted for one reason: this copy is never fed to the
 * network. It only *describes* what was fed. If it drifts, the logged rows become
 * wrong, which is bad — but the interview stays correct, whereas drift in `serve.py`
 * would silently change what the policy sees. The two Python copies are the pair that
 * had to be parity-tested.
 */
function snapshot(state: ChoiceState): number[] {
  const mastery = DEFAULT_TOPICS.map(t => state.mastery[t] ?? 0.25)
  const attempts = DEFAULT_TOPICS.map(t => Math.min(1, (state.attempts[t] ?? 0) / 3))
  const scores = state.recentScores
  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length / 100 : 0.5

  let consecutive = 0
  for (let i = scores.length - 1; i >= 0 && scores[i] < 60; i -= 1) consecutive += 1

  return [
    ...mastery,
    ...attempts,
    mean(scores.slice(-3)),
    state.questions ? Math.min(1, state.step / state.questions) : 0,
    Math.min(1, consecutive / 4),
    mean(scores.slice(-5)),
    mean(scores),
  ]
}

/**
 * Record that the controller chose `choice` from `state`.
 *
 * `score` and `belief_delta` are left null: the answer that question draws has not
 * happened yet. They are filled in by `recordOutcome` on the following request, which
 * is what turns two rows into a transition.
 */
export async function recordChoice(
  db: SupabaseClient,
  userId: string,
  sessionId: string,
  state: ChoiceState,
  choice: Choice
): Promise<void> {
  try {
    const { error } = await db.from('rl_experience').insert({
      user_id: userId,
      session_id: sessionId,
      step: state.step,
      observation: snapshot(state),
      action: choice.action ?? null,
      topic: choice.topic,
      difficulty: choice.difficulty,
      source: choice.source,
      policy: choice.policyName ?? null,
    })
    if (error) {
      if (MISSING_TABLE_CODES.has(error.code ?? '')) warnMissing()
      else console.warn('rl_experience insert failed:', error.message)
    }
  } catch (err) {
    console.warn('rl_experience insert threw:', err)
  }
}

/**
 * Attach the outcome to the decision that produced it.
 *
 * Matched on `(session_id, topic)` at the most recent unscored step rather than on a
 * step number the client supplies. Follow-up questions do not go through the chooser,
 * so the client's question index and the controller's step count drift apart during a
 * session — keying on the client's number would attach scores to the wrong decisions,
 * and nothing would report an error.
 */
export async function recordOutcome(
  db: SupabaseClient,
  sessionId: string,
  topic: string,
  score: number,
  beliefDelta: number
): Promise<void> {
  try {
    const { data, error: readError } = await db
      .from('rl_experience')
      .select('id')
      .eq('session_id', sessionId)
      .eq('topic', topic)
      .is('score', null)
      .order('step', { ascending: false })
      .limit(1)

    if (readError) {
      if (MISSING_TABLE_CODES.has(readError.code ?? '')) warnMissing()
      return
    }
    const row = data?.[0]
    // No pending row is normal, not an error: follow-ups and the LLM's own tags produce
    // answers on topics the controller never chose.
    if (!row) return

    await db
      .from('rl_experience')
      .update({ score, belief_delta: beliefDelta })
      .eq('id', row.id)
  } catch (err) {
    console.warn('rl_experience update threw:', err)
  }
}
