/**
 * Phase 2 exit criterion, checked against the live database.
 *
 * "Answer well at leadership twice, and that topic's number is visibly higher in the
 * database — and still higher in the *next* session."
 *
 * This drives the real `lib/kt/store.ts` functions the API routes call, rather than
 * reimplementing the logic, so a bug in the store is a failure here. It uses the
 * service role and cleans up after itself.
 *
 * Run: `npx tsx scripts/test-knowledge-state.ts`
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_PARAMS } from '../lib/kt/bkt'
import { getMastery, recordAnswer, seedPriors } from '../lib/kt/store'
import { parseResumeAndJD, toPriors } from '../lib/parse/parser'

config({ path: '.env.local' })

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const results: Array<{ label: string; ok: boolean; detail: string }> = []
function check(label: string, ok: boolean, detail = '') {
  results.push({ label, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const BACKEND_RESUME = `
Senior Backend Engineer, 6 years. Designed a distributed order-processing system
handling 40k requests per second. Introduced caching and sharding to cut p99 latency.
Profiled hot paths, refactored the legacy codebase, and debugged production incidents.
`
const LEADERSHIP_JD = `
Engineering Manager. Lead and mentor a team of eight engineers, run hiring and
onboarding, manage stakeholder relationships, coach direct reports, and resolve
conflict within the team. Strong communication skills required.
`

async function main() {
  // Any existing profile; the FK requires a real one.
  const { data: profiles } = await db.from('profiles').select('id').limit(1)
  const userId = profiles?.[0]?.id
  if (!userId) throw new Error('no profile rows — seed a user first')

  const { data: preexisting } = await db
    .from('knowledge_state')
    .select('topic')
    .eq('user_id', userId)
  if ((preexisting?.length ?? 0) > 0) {
    throw new Error(
      `user ${userId} already has ${preexisting!.length} knowledge_state rows; ` +
      'refusing to run so real data is not destroyed'
    )
  }

  try {
    console.log('\n1. Seeding priors from the resume/JD parser')
    const parsed = parseResumeAndJD(BACKEND_RESUME, LEADERSHIP_JD)
    const priors = toPriors(parsed)
    const seeded = await seedPriors(db, userId, priors)
    check('priors written', seeded === 15, `${seeded} rows`)

    const afterSeed = await getMastery(db, userId)
    check(
      'a backend CV against a manager JD starts weaker on leadership than on technical depth',
      afterSeed['leadership'] < afterSeed['technical-depth'],
      `leadership ${afterSeed['leadership'].toFixed(3)} < technical-depth ${afterSeed['technical-depth'].toFixed(3)}`
    )
    check(
      'every prior is a probability',
      Object.values(afterSeed).every(m => m >= 0 && m <= 1),
      `${Object.keys(afterSeed).length} topics`
    )

    console.log('\n2. Re-seeding must not overwrite (the ignoreDuplicates guard)')
    await db
      .from('knowledge_state')
      .update({ mastery: 0.9, seeded_from: 'observed' })
      .eq('user_id', userId)
      .eq('topic', 'leadership')
    await seedPriors(db, userId, priors)
    const afterReseed = await getMastery(db, userId)
    check(
      'earned mastery survives a re-seed',
      afterReseed['leadership'] === 0.9,
      `leadership still ${afterReseed['leadership']}`
    )
    await db
      .from('knowledge_state')
      .update({ mastery: priors['leadership'], seeded_from: 'parser' })
      .eq('user_id', userId)
      .eq('topic', 'leadership')

    console.log('\n3. Session one — two strong leadership answers')
    const before = (await getMastery(db, userId))['leadership']
    await recordAnswer(db, userId, ['leadership'], 82)
    await recordAnswer(db, userId, ['leadership'], 76)
    const afterTwo = (await getMastery(db, userId))['leadership']
    check(
      'mastery rises after two strong answers',
      afterTwo > before,
      `${before.toFixed(3)} → ${afterTwo.toFixed(3)}`
    )

    const { data: row } = await db
      .from('knowledge_state')
      .select('attempts, seeded_from')
      .eq('user_id', userId)
      .eq('topic', 'leadership')
      .single()
    check('attempts counted', row?.attempts === 2, `attempts=${row?.attempts}`)
    check(
      'origin flipped from parser guess to observed evidence',
      row?.seeded_from === 'observed',
      `seeded_from=${row?.seeded_from}`
    )

    console.log('\n4. A weak answer must pull mastery back down')
    const beforeWeak = (await getMastery(db, userId))['conflict']
    await recordAnswer(db, userId, ['conflict'], 20)
    const afterWeak = (await getMastery(db, userId))['conflict']
    check(
      'mastery falls after a weak answer',
      afterWeak < beforeWeak,
      `${beforeWeak.toFixed(3)} → ${afterWeak.toFixed(3)}`
    )

    console.log('\n5. Untouched topics stay untouched')
    const untouched = await getMastery(db, userId)
    check(
      'answering leadership did not move system-design',
      Math.abs(untouched['system-design'] - priors['system-design']) < 1e-9,
      `system-design ${untouched['system-design'].toFixed(3)}`
    )

    console.log('\n6. Multi-tag question updates every tagged topic')
    const b = await getMastery(db, userId)
    await recordAnswer(db, userId, ['communication', 'ownership', 'not-a-real-topic'], 90)
    const a = await getMastery(db, userId)
    check(
      'both real tags moved',
      a['communication'] > b['communication'] && a['ownership'] > b['ownership'],
      `communication ${b['communication'].toFixed(3)}→${a['communication'].toFixed(3)}, ` +
      `ownership ${b['ownership'].toFixed(3)}→${a['ownership'].toFixed(3)}`
    )
    const { data: bogus } = await db
      .from('knowledge_state')
      .select('topic')
      .eq('user_id', userId)
      .eq('topic', 'not-a-real-topic')
    check('unknown tag ignored, not written', (bogus?.length ?? 0) === 0)

    console.log('\n7. The claim: it persists across sessions')
    // A fresh read with no session context at all is exactly what the next
    // interview does — this is the whole difference from an LLM wrapper.
    const nextSession = await getMastery(db, userId)
    check(
      'leadership is still elevated in a new session',
      nextSession['leadership'] > priors['leadership'],
      `${priors['leadership'].toFixed(3)} at seed → ${nextSession['leadership'].toFixed(3)} now`
    )
    check(
      'and still above the untrained default',
      nextSession['leadership'] > DEFAULT_PARAMS.p_init,
      `${nextSession['leadership'].toFixed(3)} > ${DEFAULT_PARAMS.p_init}`
    )
  } finally {
    await db.from('knowledge_state').delete().eq('user_id', userId)
    const { data: left } = await db
      .from('knowledge_state')
      .select('topic')
      .eq('user_id', userId)
    console.log(`\nCleanup: ${left?.length ?? 0} rows remaining`)
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
