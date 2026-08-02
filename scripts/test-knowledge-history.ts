/**
 * Verifies migration 011 and the history logging in `lib/kt/store.ts` against the live
 * database.
 *
 * Drives the real `recordAnswer` / `seedPriors` the answer and start routes call, rather
 * than reimplementing them, so a bug in the store fails here. Uses the service role and
 * cleans up after itself.
 *
 * Run: `npx tsx scripts/test-knowledge-history.ts`
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
config({ path: '.env.local' })

import { recordAnswer, seedPriors, getScorecard } from '../lib/kt/store'

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

async function main() {
  const { data: profile } = await db.from('profiles').select('id').limit(1).single()
  if (!profile) {
    console.log('FAIL no profile row to attach test data to')
    process.exit(1)
  }
  const userId = profile.id as string

  // Work on topics this user has no history for, so the assertions are about rows this
  // test created rather than whatever the account has accumulated.
  const T1 = 'ambiguity'
  const T2 = 'first-principles'

  const cleanup = async () => {
    await db.from('knowledge_history').delete().eq('user_id', userId).in('topic', [T1, T2])
    await db.from('knowledge_state').delete().eq('user_id', userId).in('topic', [T1, T2])
  }
  await cleanup()

  // ── Table exists and is shaped as expected ──────────────────────────────
  const probe = await db.from('knowledge_history').select('id, topic, mastery, attempts, score, session_id, source').limit(1)
  check('knowledge_history table exists', !probe.error, probe.error?.message ?? '')
  if (probe.error) { await cleanup(); process.exit(1) }

  // ── Seeding writes 'parser' rows ────────────────────────────────────────
  const seeded = await seedPriors(db, userId, { [T1]: 0.12, [T2]: 0.31 })
  check('seedPriors inserted both topics', seeded === 2, `${seeded}`)

  const { data: afterSeed } = await db
    .from('knowledge_history').select('*').eq('user_id', userId).in('topic', [T1, T2])
  check('seeding logged to history', (afterSeed?.length ?? 0) === 2, `${afterSeed?.length} rows`)
  check(
    'seeded rows are marked "parser", not "observed"',
    (afterSeed ?? []).every(r => r.source === 'parser'),
    'charting a CV guess as learning would show improvement before any question'
  )
  check('seeded rows carry no score', (afterSeed ?? []).every(r => r.score === null))
  check('seeded rows have zero attempts', (afterSeed ?? []).every(r => r.attempts === 0))

  // Seeding again must not re-log: `ignoreDuplicates` means nothing changed, and a
  // history row for a non-update would draw a flat step that never happened.
  await seedPriors(db, userId, { [T1]: 0.99, [T2]: 0.99 })
  const { data: afterReseed } = await db
    .from('knowledge_history').select('id').eq('user_id', userId).in('topic', [T1, T2])
  check(
    're-seeding does not log a second time',
    (afterReseed?.length ?? 0) === 2,
    `${afterReseed?.length} rows — an update that did not happen must not appear`
  )

  // ── Answers write 'observed' rows ───────────────────────────────────────
  const scores = [85, 40, 78]
  for (const s of scores) await recordAnswer(db, userId, [T1], s, null)

  const { data: obs } = await db
    .from('knowledge_history').select('*')
    .eq('user_id', userId).eq('topic', T1).eq('source', 'observed')
    .order('created_at', { ascending: true })

  check('one history row per answer', (obs?.length ?? 0) === 3, `${obs?.length} rows`)
  check(
    'the causing score is recorded',
    JSON.stringify((obs ?? []).map(r => r.score)) === JSON.stringify(scores),
    (obs ?? []).map(r => r.score).join(', ')
  )
  check(
    'attempts increment across the trajectory',
    JSON.stringify((obs ?? []).map(r => r.attempts)) === JSON.stringify([1, 2, 3]),
    (obs ?? []).map(r => r.attempts).join(', ')
  )

  // ── The history agrees with the scorecard ───────────────────────────────
  // The point of the whole table: the last logged point must be what the app believes
  // now. If these drift, the chart tells a different story than the controller sees.
  const card = await getScorecard(db, userId)
  const last = (obs ?? [])[obs!.length - 1]
  check(
    'last history point equals current mastery exactly',
    last.mastery === card.mastery[T1],
    `history ${last.mastery} vs state ${card.mastery[T1]}`
  )
  check(
    'mastery kept full double precision',
    String(last.mastery).length > 5,
    `${last.mastery} — REAL would quantise this and visibly jag the trend line`
  )

  // A bad answer must be visible as a dip, or the curve is decorative.
  const masteries = (obs ?? []).map(r => r.mastery as number)
  check(
    'a poor answer moves mastery down',
    masteries[1] < masteries[0],
    `${masteries.map(m => m.toFixed(3)).join(' → ')} (85, 40, 78)`
  )

  // ── Untouched topics stay untouched ─────────────────────────────────────
  const { data: t2rows } = await db
    .from('knowledge_history').select('id').eq('user_id', userId).eq('topic', T2)
  check(
    'answering one topic logs nothing for another',
    (t2rows?.length ?? 0) === 1,
    `${t2rows?.length} row — only its seed`
  )

  await cleanup()
  console.log('  ok   test rows cleaned up')

  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) {
    console.log('\nFailures:')
    for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.label} — ${r.detail}`)
    process.exit(1)
  }
}

main().catch(async err => {
  console.error('\nTest failed to run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
