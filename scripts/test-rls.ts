/**
 * Row-level security isolation test.
 *
 * **Why this exists.** Every live run of this app so far has been with
 * `NEXT_PUBLIC_DEV_BYPASS=true`, which skips auth *and* routes writes through the
 * service-role client — which bypasses RLS entirely. So the policies in migrations 007,
 * 010 and 011 have never actually been exercised. They are believed-correct, not
 * observed-correct. Migration 010 in particular exists specifically to stop one user
 * reading another user's custom job descriptions; that claim had never been tested.
 *
 * A manual click-through cannot test this: you would have to be two people at once. So
 * this creates two real users, signs both in through the *anon* client (the same one the
 * app uses for a logged-in request), and asserts that neither can see or touch the
 * other's rows.
 *
 * The service-role key is used only to create and destroy the test users. Every
 * assertion runs through an ordinary authenticated client, because that is what a real
 * request is.
 *
 * Run: `npx tsx scripts/test-rls.ts`
 */

import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
config({ path: '.env.local' })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!URL || !ANON || !SERVICE) {
  console.error('Missing Supabase env vars — check .env.local')
  process.exit(1)
}

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results: Array<{ label: string; ok: boolean; detail: string }> = []
function check(label: string, ok: boolean, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const stamp = Date.now()
const USERS = [
  { email: `rls-a-${stamp}@example.com`, password: `Test-${stamp}-A!` },
  { email: `rls-b-${stamp}@example.com`, password: `Test-${stamp}-B!` },
]

/** Signs a user in through the anon client — the same path a real logged-in request takes. */
async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

async function main() {
  const ids: string[] = []
  const createdJdIds: string[] = []

  try {
    // ---- setup: two real users -------------------------------------------------
    for (const u of USERS) {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
      })
      if (error) throw new Error(`could not create ${u.email}: ${error.message}`)
      ids.push(data.user.id)
      // The app's signup route (app/api/auth/signup/route.ts) upserts this row itself.
      // The admin API skips that route, and the on_auth_user_created trigger swallows
      // its own errors, so without this the foreign keys below fail for reasons that
      // have nothing to do with RLS — which is what this test is actually measuring.
      await admin.from('profiles').upsert({ id: data.user.id, email: u.email })
    }
    const [idA, idB] = ids
    const A = await signIn(USERS[0].email, USERS[0].password)
    const B = await signIn(USERS[1].email, USERS[1].password)
    const anon = createClient(URL, ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    console.log(`\ntest users: A=${idA.slice(0, 8)} B=${idB.slice(0, 8)}\n`)

    // The profiles row is created by a trigger on signup (migration 005). If it is
    // missing, the foreign keys below fail for reasons unrelated to RLS.
    const { data: profA } = await admin.from('profiles').select('id').eq('id', idA).maybeSingle()
    check('profile row exists for A', !!profA, profA ? '' : 'no profiles row')

    // ---- knowledge_state (migration 007) ---------------------------------------
    {
      const { error } = await A.from('knowledge_state').insert({
        user_id: idA, topic: 'system-design', mastery: 0.42, attempts: 3,
      })
      check('A can write own knowledge_state', !error, error?.message ?? '')

      const { data: seen } = await B.from('knowledge_state').select('*').eq('user_id', idA)
      check('B cannot read A knowledge_state', (seen?.length ?? 0) === 0,
        `saw ${seen?.length ?? 0} rows`)

      const { error: forgeErr } = await B.from('knowledge_state').insert({
        user_id: idA, topic: 'leadership', mastery: 0.99, attempts: 1,
      })
      check('B cannot forge a row as A', !!forgeErr, forgeErr ? '' : 'insert was ALLOWED')

      const { data: upd } = await B.from('knowledge_state')
        .update({ mastery: 0.01 }).eq('user_id', idA).select()
      check('B cannot update A knowledge_state', (upd?.length ?? 0) === 0,
        `updated ${upd?.length ?? 0} rows`)
    }

    // ---- knowledge_history (migration 011) -------------------------------------
    {
      const { error } = await A.from('knowledge_history').insert({
        user_id: idA, topic: 'system-design', mastery: 0.42, attempts: 3,
        score: 70, source: 'observed',
      })
      check('A can write own knowledge_history', !error, error?.message ?? '')

      const { data: seen } = await B.from('knowledge_history').select('*').eq('user_id', idA)
      check('B cannot read A knowledge_history', (seen?.length ?? 0) === 0,
        `saw ${seen?.length ?? 0} rows`)

      const { data: del } = await B.from('knowledge_history')
        .delete().eq('user_id', idA).select()
      check('B cannot delete A knowledge_history', (del?.length ?? 0) === 0,
        `deleted ${del?.length ?? 0} rows`)
    }

    // ---- job_descriptions (migration 010) — the privacy fix ---------------------
    {
      const jdId = crypto.randomUUID()
      const { error } = await A.from('job_descriptions').insert({
        id: jdId, user_id: idA, company_name: 'RLS Test Co',
        role_type: 'Software Engineering', role_subtype: 'Backend',
        industry: 'Testing', jd_text: 'private to A', company_tier: 'Other',
      })
      check('A can create own custom JD', !error, error?.message ?? '')
      if (!error) createdJdIds.push(jdId)

      const { data: seen } = await B.from('job_descriptions').select('id').eq('id', jdId)
      check("B cannot read A's custom JD", (seen?.length ?? 0) === 0,
        `saw ${seen?.length ?? 0} rows`)

      const { data: anonSeen } = await anon.from('job_descriptions').select('id').eq('id', jdId)
      check("logged-out cannot read A's custom JD", (anonSeen?.length ?? 0) === 0,
        `saw ${anonSeen?.length ?? 0} rows`)

      // The other half of migration 010: seeded JDs (user_id IS NULL) must stay
      // readable by everyone, or nobody can start an interview.
      const { data: seeded, error: seedErr } = await B.from('job_descriptions')
        .select('id').is('user_id', null).limit(1)
      check('seeded JDs still readable by any user', !seedErr && (seeded?.length ?? 0) > 0,
        seedErr?.message ?? `${seeded?.length ?? 0} rows`)

      const { data: del } = await B.from('job_descriptions').delete().eq('id', jdId).select()
      check("B cannot delete A's custom JD", (del?.length ?? 0) === 0,
        `deleted ${del?.length ?? 0} rows`)
    }

    // ---- sessions ---------------------------------------------------------------
    {
      const { data: sess, error } = await A.from('sessions').insert({
        user_id: idA, status: 'in_progress', round_type: 'technical',
      }).select('id').maybeSingle()
      check('A can create own session', !error && !!sess, error?.message ?? '')

      if (sess) {
        const { data: seen } = await B.from('sessions').select('id').eq('id', sess.id)
        check("B cannot read A's session", (seen?.length ?? 0) === 0,
          `saw ${seen?.length ?? 0} rows`)
      }
    }

    // ---- the baseline sanity check ---------------------------------------------
    // If A cannot see A's own data, the policies are too tight and the app is broken
    // for everybody — the opposite failure, equally important to catch.
    {
      const { data: own } = await A.from('knowledge_state').select('*').eq('user_id', idA)
      check('A can still read own data (not over-locked)', (own?.length ?? 0) > 0,
        `saw ${own?.length ?? 0} rows`)
    }
  } finally {
    // ---- cleanup ---------------------------------------------------------------
    for (const id of createdJdIds) await admin.from('job_descriptions').delete().eq('id', id)
    for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {})
    console.log('\ncleaned up test users and rows')
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    console.log('\nFAILURES — these are live security holes, not test bugs:')
    for (const f of failed) console.log(`  - ${f.label}${f.detail ? ` (${f.detail})` : ''}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('\nfatal:', err.message)
  process.exit(1)
})
