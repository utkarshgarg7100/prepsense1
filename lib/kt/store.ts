/**
 * Reading and writing the persistent scorecard (`knowledge_state`).
 *
 * Kept separate from `lib/kt/bkt.ts` so the maths stays pure and testable without a
 * database — the same split as `ml/bkt.py`, which has no I/O either.
 *
 * Every function here is written to **degrade rather than throw**. Knowledge tracing
 * is an enhancement layered onto a working interview: if the table is missing or a
 * write fails, the candidate should still get their question and their feedback. A
 * lost mastery update costs one data point; a thrown error costs the interview.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyAnswer,
  DEFAULT_PARAMS,
  DEFAULT_TOPICS,
  type MasteryUpdate,
} from './bkt'

/** Postgres/PostgREST codes meaning "migration 007 has not been applied here". */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST002'])

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    MISSING_TABLE_CODES.has(error.code ?? '') ||
    (error.message ?? '').includes('knowledge_state')
  )
}

let missingTableWarned = false
function warnMissingTable(): void {
  // Once per process: this fires on every answer otherwise, and a wall of identical
  // warnings hides the ones that matter.
  if (missingTableWarned) return
  missingTableWarned = true
  console.warn(
    'knowledge_state table not found — apply supabase/migrations/007_knowledge_state.sql. ' +
    'Interviews still work; per-topic mastery is not being persisted.'
  )
}

/**
 * Current mastery for one user, defaulted for any topic with no row yet.
 *
 * Always returns all 15 topics. Callers index this positionally (the RL policy's
 * observation vector), so a partial map would silently shift every action.
 */
export async function getMastery(
  db: SupabaseClient,
  userId: string
): Promise<Record<string, number>> {
  const mastery: Record<string, number> = Object.fromEntries(
    DEFAULT_TOPICS.map(t => [t, DEFAULT_PARAMS.p_init])
  )

  const { data, error } = await db
    .from('knowledge_state')
    .select('topic, mastery')
    .eq('user_id', userId)

  if (error) {
    if (isMissingTable(error)) warnMissingTable()
    else console.warn('knowledge_state read failed; using default priors:', error.message)
    return mastery
  }

  for (const row of data ?? []) {
    if (row.topic in mastery) mastery[row.topic] = row.mastery
  }
  return mastery
}

/**
 * Mastery *and* attempt counts, in one query.
 *
 * The curriculum controller needs both — attempts are what tell it a topic has already
 * been covered, and getting that feature wrong was the single most expensive bug of
 * Phase 4 (see `ml/student_sim.py`, `ATTEMPT_SCALE`). Fetching them together rather
 * than calling `getMastery` twice keeps the two consistent: read separately, an answer
 * landing between the two queries yields a mastery and an attempt count describing
 * different moments.
 *
 * Degrades like everything else here: on any failure the caller gets default priors and
 * zero attempts, which makes the chooser behave like a first-ever session rather than
 * fail.
 */
export async function getScorecard(
  db: SupabaseClient,
  userId: string
): Promise<{ mastery: Record<string, number>; attempts: Record<string, number> }> {
  const mastery: Record<string, number> = Object.fromEntries(
    DEFAULT_TOPICS.map(t => [t, DEFAULT_PARAMS.p_init])
  )
  const attempts: Record<string, number> = Object.fromEntries(
    DEFAULT_TOPICS.map(t => [t, 0])
  )

  const { data, error } = await db
    .from('knowledge_state')
    .select('topic, mastery, attempts')
    .eq('user_id', userId)

  if (error) {
    if (isMissingTable(error)) warnMissingTable()
    else console.warn('knowledge_state read failed; using default priors:', error.message)
    return { mastery, attempts }
  }

  for (const row of data ?? []) {
    if (row.topic in mastery) {
      mastery[row.topic] = row.mastery
      attempts[row.topic] = row.attempts ?? 0
    }
  }
  return { mastery, attempts }
}

/**
 * The single 0–100 figure BKT's binary observation is derived from.
 *
 * `depth_score` alone. The rubric (`lib/prompts`) produces exactly two numbers, and
 * the other one — `star_compliance` — measures whether the answer followed the STAR
 * *format*. That is worth coaching but is the wrong evidence for topic mastery: a
 * correct, well-reasoned system-design answer has no "Situation" or "Result" and
 * would be scored as ignorance. `depth_score` is defined in the prompt as
 * specificity, metrics and technical accuracy, which is what mastery means here.
 *
 * If the rubric ever gains a relevance or correctness score, this is the one place
 * to blend it in.
 */
export function evaluationToScore(evaluation: { depth_score: number }): number {
  return evaluation.depth_score
}

/**
 * Update mastery for every topic an answered question was tagged with, and persist.
 *
 * Returns the updates that were applied, so the caller can log or surface them.
 * Returns an empty array when nothing could be written — including when the
 * question carried no recognised tags, which is normal for LLM-generated tags.
 */
export async function recordAnswer(
  db: SupabaseClient,
  userId: string,
  topics: string[],
  score: number,
  /** Optional so existing callers and tests keep working; used to attribute history. */
  sessionId: string | null = null
): Promise<MasteryUpdate[]> {
  if (topics.length === 0) return []

  try {
    const current = await getMastery(db, userId)
    const updates = applyAnswer(current, topics, score)
    if (updates.length === 0) return []

    // Read-modify-write, not an atomic increment: BKT's update is non-linear in the
    // prior, so it cannot be expressed as a SQL increment. Two answers to the same
    // topic racing would lose one update. Acceptable — a single user answers one
    // question at a time, and the cost is one missed observation, not corruption.
    const { data: existing } = await db
      .from('knowledge_state')
      .select('topic, attempts')
      .eq('user_id', userId)
      .in('topic', updates.map(u => u.topic))

    const attemptsByTopic = new Map(
      (existing ?? []).map(row => [row.topic, row.attempts as number])
    )

    const { error } = await db.from('knowledge_state').upsert(
      updates.map(u => ({
        user_id: userId,
        topic: u.topic,
        mastery: u.after,
        attempts: (attemptsByTopic.get(u.topic) ?? 0) + 1,
        seeded_from: 'observed',
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'user_id,topic' }
    )

    if (error) {
      if (isMissingTable(error)) warnMissingTable()
      else console.warn('knowledge_state write failed:', error.message)
      return []
    }

    await appendHistory(db, userId, updates, attemptsByTopic, score, sessionId, 'observed')

    return updates
  } catch (err) {
    console.warn('knowledge_state update skipped:', err)
    return []
  }
}

/**
 * Append to the mastery trajectory (migration 011).
 *
 * Never throws and never blocks the caller's result. The history is for the dashboard
 * and for comparing real trajectories against the simulator's; losing a point costs a
 * pixel on a chart, whereas an exception here would cost the candidate their answer.
 * Same reasoning as every other write in this module.
 *
 * Deliberately not a database trigger on `knowledge_state`: a trigger would also fire
 * for the parser's seeding upsert with no way to see the score that caused the change,
 * and the distinction between a seeded guess and earned evidence is the whole point of
 * the `source` column.
 */
async function appendHistory(
  db: SupabaseClient,
  userId: string,
  // Only the resulting value is needed, so this takes the narrow shape rather than a
  // full `MasteryUpdate` — that lets seeding, which has no gain or confidence, share it.
  updates: Array<{ topic: string; after: number }>,
  attemptsByTopic: Map<string, number>,
  score: number | null,
  sessionId: string | null,
  source: 'parser' | 'observed'
): Promise<void> {
  try {
    const { error } = await db.from('knowledge_history').insert(
      updates.map(u => ({
        user_id: userId,
        topic: u.topic,
        mastery: u.after,
        attempts: (attemptsByTopic.get(u.topic) ?? 0) + (source === 'observed' ? 1 : 0),
        score,
        session_id: sessionId,
        source,
      }))
    )
    if (error && !isMissingTable(error)) {
      console.warn('knowledge_history write failed:', error.message)
    }
  } catch (err) {
    console.warn('knowledge_history write skipped:', err)
  }
}

/**
 * Seed a new user's priors from the resume/JD parser (Model 5).
 *
 * Only fills topics that have no row yet — `ignoreDuplicates` rather than an upsert.
 * A prior derived from keyword matching on two documents must never overwrite
 * mastery the candidate actually earned by answering questions.
 */
export async function seedPriors(
  db: SupabaseClient,
  userId: string,
  priors: Record<string, number>
): Promise<number> {
  const rows = DEFAULT_TOPICS.filter(t => t in priors).map(topic => ({
    user_id: userId,
    topic,
    mastery: priors[topic],
    attempts: 0,
    seeded_from: 'parser',
  }))
  if (rows.length === 0) return 0

  const { data, error } = await db
    .from('knowledge_state')
    .upsert(rows, { onConflict: 'user_id,topic', ignoreDuplicates: true })
    .select('topic')

  if (error) {
    if (isMissingTable(error)) warnMissingTable()
    else console.warn('knowledge_state seed failed:', error.message)
    return 0
  }

  // Only the topics actually inserted are logged. `ignoreDuplicates` means a returning
  // user's existing topics were left alone, and writing history for an update that did
  // not happen would draw a flat line where the truth is "nothing changed".
  const seeded = data ?? []
  if (seeded.length > 0) {
    await appendHistory(
      db,
      userId,
      seeded.map(r => ({ topic: r.topic as string, after: priors[r.topic] })),
      new Map(),
      null,   // no answer caused this
      null,   // seeding happens before the session row is meaningful to the curve
      'parser'
    )
  }
  return seeded.length
}
