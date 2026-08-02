/**
 * PrepSense End-to-End Data Storage Test
 *
 * Tests the full user data lifecycle by inserting a mock user directly via
 * service role (bypasses email auth which requires SMTP config).
 * All data assertions match what the real app routes do.
 *
 * Run:
 *   npx ts-node --project prepsense-seed/tsconfig.json scripts/test-user-flow.ts
 */

import dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing env vars — check .env.local')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RESULTS: { label: string; ok: boolean; detail?: string }[] = []

function pass(label: string) {
  console.log(`  ✅ ${label}`)
  RESULTS.push({ label, ok: true })
}

function fail(label: string, detail?: string) {
  console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  RESULTS.push({ label, ok: false, detail })
}

function section(title: string) {
  console.log(`\n${'─'.repeat(55)}\n🧪 ${title}`)
}

function ok(label: string, condition: boolean, detail?: string) {
  condition ? pass(label) : fail(label, detail)
}

// ─── Test data ───────────────────────────────────────────────────────────────

// Generate a stable UUID for this run
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const MOCK_ID    = uuid()
const MOCK_EMAIL = `test-prepsense-${Date.now()}@mailinator.com`
const MOCK_NAME  = 'PrepSense Tester'

let sessionId: string | null = null
let resumeId:  string | null = null

// ─── Steps ───────────────────────────────────────────────────────────────────

async function step0_CreateAuthUser() {
  section('STEP 0: Create auth.users row via RPC helper')

  // Uses a SECURITY DEFINER function (migration 004) that inserts directly
  // into auth.users without requiring email/SMTP to be configured.
  const { error } = await db.rpc('create_test_auth_user', {
    p_id: MOCK_ID,
    p_email: MOCK_EMAIL,
  })

  ok('auth.users row created', !error, error?.message)

  if (error) {
    console.error('\n  ⛔ FATAL: Cannot create auth user.')
    console.error('  → Run migration 004 in Supabase SQL editor first:')
    console.error('     supabase/migrations/004_test_helpers_and_fixes.sql\n')
    process.exit(1)
  }
}

async function step1_ProfileCreation() {
  section('STEP 1: Profile creation (simulates post-signup DB trigger)')

  // The create_test_auth_user RPC triggers handle_new_user() which auto-creates
  // the profile row. Read it back to verify the trigger fired correctly.
  const { data: profile, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', MOCK_ID)
    .single()

  ok('Profile row exists (trigger fired)', !error && !!profile, error?.message)
  ok('ID matches mock user',              profile?.id === MOCK_ID)
  ok('Email stored correctly',            profile?.email === MOCK_EMAIL)
  ok('onboarding_completed = false',      profile?.onboarding_completed === false)
  ok('target_roles defaults to []',       Array.isArray(profile?.target_roles))
}

async function step2_Onboarding() {
  section('STEP 2: Onboarding save (simulates /onboarding page submit)')

  const { data: profile, error } = await db
    .from('profiles')
    .upsert({
      id: MOCK_ID,
      email: MOCK_EMAIL,
      full_name: MOCK_NAME,
      target_roles: ['Software Engineer', 'Backend Engineer'],
      target_companies: ['Google', 'Razorpay'],
      experience_level: '1-3yr',
      onboarding_completed: true,
    }, { onConflict: 'id' })
    .select()
    .single()

  ok('Upsert succeeded',                  !error && !!profile, error?.message)
  ok('onboarding_completed = true',       profile?.onboarding_completed === true)
  ok('target_roles saved',                profile?.target_roles?.includes('Software Engineer'))
  ok('target_companies saved',            profile?.target_companies?.includes('Google'))
  ok('experience_level saved',            profile?.experience_level === '1-3yr')
}

async function step3_ResumeUpload() {
  section('STEP 3: Resume upload (simulates /api/resume/upload)')

  const { data: resume, error } = await db
    .from('resumes')
    .insert({
      user_id: MOCK_ID,
      file_url: 'https://example.com/test-resume.pdf',
      file_name: 'test-resume.pdf',
      parsed_text: 'John Doe | Software Engineer | Node.js React PostgreSQL TypeScript',
      extracted_skills: ['Node.js', 'React', 'PostgreSQL', 'TypeScript'],
      is_active: true,
    })
    .select()
    .single()

  ok('Resume row inserted',             !error && !!resume, error?.message)
  ok('file_name stored',                resume?.file_name === 'test-resume.pdf')
  ok('extracted_skills stored',         resume?.extracted_skills?.includes('Node.js'))
  ok('is_active = true',                resume?.is_active === true)
  ok('user_id foreign key correct',     resume?.user_id === MOCK_ID)

  resumeId = resume?.id ?? null
}

async function step4_SessionAndMessages() {
  section('STEP 4: Session creation + messages (simulates /api/interview/start + /answer)')

  // Get a real JD from the seeded data
  const { data: jd } = await db
    .from('job_descriptions')
    .select('id, company_name, role_subtype')
    .limit(1)
    .single()

  if (!jd) { fail('No JDs in database — run npm run seed first'); return }
  pass(`Using seeded JD: ${jd.company_name} — ${jd.role_subtype}`)

  const { data: session, error: sErr } = await db
    .from('sessions')
    .insert({
      user_id: MOCK_ID,
      jd_id: jd.id,
      mode: 'jd_based',
      round_type: 'technical',
      status: 'in_progress',
      question_plan: { total_questions: 12, questions: [] },
      gap_matrix: { matched: ['Node.js', 'React'], missing: ['Go', 'Kubernetes'], partial: ['PostgreSQL'] },
    })
    .select()
    .single()

  ok('Session created',                 !sErr && !!session, sErr?.message)
  ok('status = in_progress',            session?.status === 'in_progress')
  ok('gap_matrix stored as JSONB',      !!session?.gap_matrix?.matched)
  ok('question_plan stored as JSONB',   session?.question_plan?.total_questions === 12)

  sessionId = session?.id ?? null

  // Insert 2 messages (interviewer Q + candidate A)
  const { error: mErr } = await db.from('messages').insert([
    {
      session_id: sessionId,
      role: 'interviewer',
      content: 'Tell me about a distributed system you designed.',
      question_type: 'technical',
      question_tags: ['system-design', 'technical-depth'],
    },
    {
      session_id: sessionId,
      role: 'candidate',
      content: 'I built a rate-limiting service using Redis sorted sets at scale...',
      question_type: 'technical',
      question_tags: ['technical-depth'],
      answer_evaluation: {
        depth_score: 78,
        star_compliance: 65,
        filler_word_count: 2,
        strengths: ['Strong technical depth', 'Specific metrics cited'],
        improvements: ['Add STAR structure', 'Mention trade-offs'],
        answer_summary: 'Good technical answer, missing result quantification',
        strong_answer_example: 'We reduced P99 latency by 40% by switching to a token bucket algorithm...',
      },
    },
  ])

  ok('Messages inserted (2)',          !mErr, mErr?.message)

  const { data: msgs } = await db.from('messages').select('*').eq('session_id', sessionId!)
  ok('Both messages retrievable',      msgs?.length === 2)
  ok('answer_evaluation JSONB stored', !!msgs?.find(m => m.role === 'candidate')?.answer_evaluation?.depth_score)
  ok('question_tags array stored',     msgs?.find(m => m.role === 'interviewer')?.question_tags?.includes('system-design'))
}

async function step5_Completion() {
  section('STEP 5: Session completion + scores + speech (simulates /api/interview/complete)')

  if (!sessionId) { fail('No session — skipping'); return }

  // Mark session completed (column is total_duration_seconds in schema)
  const { error: uErr } = await db
    .from('sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString(), total_duration_seconds: 847 })
    .eq('id', sessionId)

  ok('Session marked completed',       !uErr, uErr?.message)

  const { data: sess } = await db.from('sessions').select('status, total_duration_seconds').eq('id', sessionId).single()
  ok('status = completed in DB',       sess?.status === 'completed')
  ok('total_duration_seconds stored',  sess?.total_duration_seconds === 847)

  // Insert session scores
  const { error: scErr } = await db.from('session_scores').insert({
    session_id: sessionId,
    user_id: MOCK_ID,
    overall_score: 72,
    technical_depth: 78,
    communication_clarity: 68,
    star_compliance: 65,
    ownership_signals: 70,
    answer_conciseness: 60,
    consistency: 75,
    cultural_alignment: 65,
    problem_decomposition: 72,
  })

  ok('Session scores inserted',        !scErr, scErr?.message)

  const { data: score } = await db.from('session_scores').select('overall_score, technical_depth').eq('session_id', sessionId).single()
  ok('overall_score = 72 in DB',       score?.overall_score === 72)
  ok('technical_depth = 78 in DB',     score?.technical_depth === 78)

  // Insert speech feedback (no user_id column — only session_id FK)
  const { error: spErr } = await db.from('speech_feedback').insert({
    session_id: sessionId,
    filler_word_count: 8,
    filler_words: { um: 3, like: 4, basically: 1 },
    avg_answer_length_seconds: 95,
    ideal_range_min: 90,
    ideal_range_max: 120,
    deflection_count: 1,
    hedging_count: 2,
    pace_assessment: 'good',
  })

  ok('Speech feedback inserted',       !spErr, spErr?.message)
}

async function step6_StreakAndBadges() {
  section('STEP 6: Streak + Badge award (simulates completion flow)')

  const { error: stErr } = await db.from('user_streaks').upsert({
    user_id: MOCK_ID,
    current_streak: 1,
    longest_streak: 1,
    last_session_date: new Date().toISOString().split('T')[0],
    total_sessions: 1,
  }, { onConflict: 'user_id' })

  ok('Streak upserted',                !stErr, stErr?.message)

  const { data: streak } = await db.from('user_streaks').select('*').eq('user_id', MOCK_ID).single()
  ok('current_streak = 1',            streak?.current_streak === 1)
  ok('total_sessions = 1',            streak?.total_sessions === 1)

  // Award "First Shot" badge (condition: session_count = 1)
  const { data: badge } = await db.from('badges').select('id, name').eq('condition_type', 'session_count').eq('condition_value', 1).single()
  ok('First Shot badge exists in DB',  !!badge, 'Run npm run seed to populate badges')

  if (badge) {
    const { error: achErr } = await db.from('user_achievements').insert({ user_id: MOCK_ID, badge_id: badge.id })
    ok('Achievement row inserted',     !achErr, achErr?.message)

    const { data: ach } = await db.from('user_achievements').select('*, badges(name)').eq('user_id', MOCK_ID).single()
    ok('Badge name joins correctly',   ach?.badges?.name === badge.name)
  }
}

async function step7_DashboardReadback() {
  section('STEP 7: Full readback (simulates dashboard page load)')

  const [
    { data: profile },
    { data: resumes },
    { data: sessions },
    { data: achievements },
    { data: streak },
    { data: speech },
  ] = await Promise.all([
    db.from('profiles').select('*').eq('id', MOCK_ID).single(),
    db.from('resumes').select('*').eq('user_id', MOCK_ID),
    db.from('sessions').select('*, session_scores(*), job_descriptions(company_name)').eq('user_id', MOCK_ID).order('started_at', { ascending: false }),
    db.from('user_achievements').select('*, badges(name, icon)').eq('user_id', MOCK_ID),
    db.from('user_streaks').select('*').eq('user_id', MOCK_ID).single(),
    db.from('speech_feedback').select('*').eq('session_id', sessionId ?? '').maybeSingle(),
  ])

  ok('Profile readable',               !!profile)
  ok('Resume readable',                (resumes?.length ?? 0) >= 1)
  ok('Session readable',               (sessions?.length ?? 0) >= 1)
  // session_scores has UNIQUE FK so PostgREST returns an object, not array
  const scoreObj = sessions?.[0]?.session_scores
  const hasScore = Array.isArray(scoreObj) ? scoreObj.length > 0 : !!scoreObj?.overall_score
  ok('Session scores nested',          hasScore)
  ok('JD name joined on session',      !!sessions?.[0]?.job_descriptions?.company_name)
  ok('Achievement readable',           (achievements?.length ?? 0) >= 1)
  ok('Badge icon via join',            !!achievements?.[0]?.badges?.icon)
  ok('Streak readable',                streak?.current_streak === 1)
  ok('Speech feedback readable',       speech?.filler_word_count === 8)

  console.log('\n  📊 Snapshot of stored data:')
  console.log(`     Profile:     ${profile?.full_name} | ${profile?.experience_level} | onboarding=${profile?.onboarding_completed}`)
  console.log(`     Resume:      ${resumes?.[0]?.file_name} | skills: [${resumes?.[0]?.extracted_skills?.slice(0,3).join(', ')}...]`)
  const scoreSnap = Array.isArray(sessions?.[0]?.session_scores) ? sessions?.[0]?.session_scores?.[0]?.overall_score : sessions?.[0]?.session_scores?.overall_score
  console.log(`     Session:     ${sessions?.[0]?.job_descriptions?.company_name} | status=${sessions?.[0]?.status} | score=${scoreSnap}`)
  console.log(`     Achievement: ${achievements?.[0]?.badges?.icon} ${achievements?.[0]?.badges?.name}`)
  console.log(`     Streak:      ${streak?.current_streak} day(s) | total=${streak?.total_sessions}`)
  console.log(`     Speech:      ${speech?.filler_word_count} fillers | pace=${speech?.pace_assessment}`)
}

async function cleanup() {
  section('CLEANUP: Removing all test data')

  // delete_test_auth_user cascades to profiles, sessions, resumes, etc.
  // via FK ON DELETE CASCADE chains.
  const { error } = await db.rpc('delete_test_auth_user', { p_id: MOCK_ID })
  ok('Auth user + cascaded data deleted', !error, error?.message)

  // Belt-and-suspenders: clean up anything that may not cascade
  await db.from('user_achievements').delete().eq('user_id', MOCK_ID)
  await db.from('user_streaks').delete().eq('user_id', MOCK_ID)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 PrepSense End-to-End Data Storage Test')
  console.log(`   Supabase: ${SUPABASE_URL}`)
  console.log(`   Mock user ID: ${MOCK_ID}`)
  console.log(`   Mock email:   ${MOCK_EMAIL}`)

  try {
    await step0_CreateAuthUser()
    await step1_ProfileCreation()
    await step2_Onboarding()
    await step3_ResumeUpload()
    await step4_SessionAndMessages()
    await step5_Completion()
    await step6_StreakAndBadges()
    await step7_DashboardReadback()
  } finally {
    await cleanup()
  }

  const failed  = RESULTS.filter(r => !r.ok)
  const passed  = RESULTS.filter(r =>  r.ok)

  console.log(`\n${'═'.repeat(55)}`)
  console.log(`  Results: ${passed.length} passed, ${failed.length} failed`)

  if (failed.length > 0) {
    console.log('\n  Failed checks:')
    failed.forEach(f => console.log(`    ❌ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`))
    console.log('\n⚠️  Some checks failed — see above.\n')
    process.exit(1)
  } else {
    console.log('\n🎉 All checks passed — user data is stored correctly!\n')
  }
}

main().catch(err => {
  console.error('\n💥 Unexpected error:', err.message)
  process.exit(1)
})
