/**
 * Verifies migration 009 and the experience logger against the live database.
 *
 * Drives the real `lib/rl/experience.ts` functions the answer route calls, rather than
 * reimplementing them, so a bug in the logger fails here. Uses the service role and
 * cleans up after itself.
 *
 * Run: `npx tsx scripts/test-rl-experience.ts`
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_TOPICS } from '../lib/kt/bkt'
import { recordChoice, recordOutcome } from '../lib/rl/experience'
import type { ChoiceState } from '../lib/ai/chooser'

config({ path: '.env.local' })

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const results: Array<{ label: string; ok: boolean; detail: string }> = []
function check(label: string, ok: boolean, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const state: ChoiceState = {
  mastery: Object.fromEntries(DEFAULT_TOPICS.map(t => [t, 0.4])),
  attempts: Object.fromEntries(DEFAULT_TOPICS.map(t => [t, 1])),
  recentScores: [72, 55, 48],
  step: 4,
  questions: 12,
}

async function main() {
  // A real session is needed: `session_id` is a foreign key, and testing against a
  // fabricated UUID would pass while the production path fails on the constraint.
  const { data: session } = await db
    .from('sessions')
    .select('id, user_id')
    .limit(1)
    .single()

  if (!session) {
    console.log('No sessions in the database — run one interview first.')
    process.exit(1)
  }

  await db.from('rl_experience').delete().eq('session_id', session.id)

  // --- 1. A policy decision is stored ---------------------------------------
  await recordChoice(db, session.user_id, session.id, state, {
    topic: 'leadership',
    difficulty: 'medium',
    source: 'policy',
    policyName: 'ppo_v6_seed0',
    action: 4,
  })

  const { data: rows, error } = await db
    .from('rl_experience')
    .select('*')
    .eq('session_id', session.id)

  if (error) {
    console.log(`\nrl_experience unavailable: ${error.message}`)
    console.log('Apply supabase/migrations/009_rl_experience.sql and re-run.')
    process.exit(1)
  }

  check('choice is stored', rows?.length === 1, `${rows?.length ?? 0} row(s)`)
  const row = rows?.[0]
  check('topic and difficulty round-trip', row?.topic === 'leadership' && row?.difficulty === 'medium')
  check('source and policy recorded', row?.source === 'policy' && row?.policy === 'ppo_v6_seed0')
  check('action index recorded', row?.action === 4)
  // The whole point of the column: an analysis has to see exactly what the net was fed.
  check('observation is the full 35 floats', row?.observation?.length === 35, `${row?.observation?.length}`)
  check('observation matches the state', Math.abs((row?.observation?.[0] ?? 0) - 0.4) < 1e-9)
  check('outcome starts empty', row?.score === null && row?.belief_delta === null)

  // --- 2. The outcome closes the transition ---------------------------------
  await recordOutcome(db, session.id, 'leadership', 71, 0.058)
  const { data: closed } = await db
    .from('rl_experience')
    .select('score, belief_delta')
    .eq('id', row!.id)
    .single()
  check('score attached', closed?.score === 71)
  check('belief delta attached', Math.abs((closed?.belief_delta ?? 0) - 0.058) < 1e-9)

  // --- 3. A second outcome must not overwrite the first ---------------------
  // Guards the matching rule: `recordOutcome` targets the most recent *unscored* row,
  // so a repeat answer on the same topic has to find nothing rather than re-write
  // history. Getting this wrong would corrupt trajectories silently.
  await recordOutcome(db, session.id, 'leadership', 20, -0.9)
  const { data: unchanged } = await db
    .from('rl_experience')
    .select('score')
    .eq('id', row!.id)
    .single()
  check('a closed transition is not overwritten', unchanged?.score === 71, `score=${unchanged?.score}`)

  // --- 4. A fallback decision records no policy ----------------------------
  await recordChoice(db, session.user_id, session.id, { ...state, step: 5 }, {
    topic: 'metrics',
    difficulty: 'easy',
    source: 'thompson',
  })
  const { data: fallback } = await db
    .from('rl_experience')
    .select('source, policy, action')
    .eq('session_id', session.id)
    .eq('step', 5)
    .single()
  check(
    'fallback rows are distinguishable from policy rows',
    fallback?.source === 'thompson' && fallback?.policy === null && fallback?.action === null
  )

  await db.from('rl_experience').delete().eq('session_id', session.id)
  check('cleanup', true)

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
