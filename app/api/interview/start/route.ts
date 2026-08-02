import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAIProvider } from '@/lib/ai/router'
import { seedPriors } from '@/lib/kt/store'
import { parseResumeAndJD, toPriors, weakestTopics } from '@/lib/parse/parser'
import type { ApiResponse, InterviewContext, QuestionPlan, Session } from '@/types'

const StartInterviewSchema = z.object({
  jd_id: z.string().optional(),
  resume_id: z.string().uuid().optional(),
  mode: z.enum(['jd_based', 'general', 'custom']),
  round_type: z.enum(['technical', 'founders', 'hr']),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const bypass = process.env.NEXT_PUBLIC_DEV_BYPASS === 'true'
    const mockMode = bypass && process.env.MOCK_AI === 'true'

    if (!user && !bypass) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Unauthorized' }, { status: 401 })
    }

    // In bypass mode use a stable dev user ID and service client to bypass RLS
    const userId = user?.id ?? '00000000-0000-0000-0000-000000000000'
    const db = bypass ? await createServiceClient() : supabase

    const body = await request.json()
    const parsed = StartInterviewSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: parsed.error.message }, { status: 400 })
    }

    const { jd_id, resume_id, mode, round_type } = parsed.data

    // Fetch resume
    let resumeText = ''
    let resumeSkills: string[] = []
    let activeResumeId = resume_id

    if (resume_id) {
      const { data: resume } = await db
        .from('resumes')
        .select('*')
        .eq('id', resume_id)
        .eq('user_id', userId)
        .single()
      if (resume) {
        resumeText = resume.parsed_text
        resumeSkills = resume.extracted_skills ?? []
      }
    } else {
      const { data: activeResume } = await db
        .from('resumes')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .single()
      if (activeResume) {
        resumeText = activeResume.parsed_text
        resumeSkills = activeResume.extracted_skills ?? []
        activeResumeId = activeResume.id
      }
    }

    // Fetch JD
    let jdText = ''
    let companyName = 'this company'
    let roleName = 'this role'

    if (jd_id) {
      const { data: jd } = await db
        .from('job_descriptions')
        .select('*')
        .eq('id', jd_id)
        .single()
      if (jd) {
        jdText = jd.jd_text
        companyName = jd.company_name
        roleName = jd.role_subtype
      }
    }

    // Seed this user's starting mastery from the classical parser (Model 5) before
    // the first question. Only fills topics with no row yet, so a returning user's
    // earned mastery is never overwritten by keyword matching on their CV — see
    // `seedPriors`. Cheap enough (~5ms, no network) to run on every session start.
    let parserGaps: string[] = []
    if (resumeText || jdText) {
      const parsed5 = parseResumeAndJD(resumeText, jdText)
      parserGaps = weakestTopics(parsed5, 5)
      const seeded = await seedPriors(db, userId, toPriors(parsed5))
      if (seeded > 0) {
        console.info(
          `seeded ${seeded} knowledge_state priors for ${userId} ` +
          `(weakest: ${parserGaps.slice(0, 3).join(', ')})`
        )
      }
    }

    const gapMatrix = mockMode || !jdText
      ? {
          matched_skills: resumeSkills.slice(0, 5),
          missing_skills: ['System Design', 'TypeScript'],
          partial_match_skills: ['React', 'Node.js'],
          gap_severity: 'medium' as const,
          recommended_focus_areas: ['system design', 'behavioral questions', 'technical depth'],
        }
      : await (await getAIProvider()).buildGapMatrix(resumeSkills, jdText)

    // Two gap analyses used to coexist without meeting: Model 5 seeded the priors while
    // the LLM's `recommended_focus_areas` drove "Known Gap Areas" in the interviewer
    // prompt. So the scorecard could start low on `ambiguity` while the interviewer was
    // told to probe "distributed systems" — the same interview pursuing two different
    // notions of what the candidate is weak at.
    //
    // The parser's list wins where it exists, for two reasons: it is stated in the same
    // 15-topic vocabulary the controller and the scorecard use, so the prompt and the
    // policy now name the same things; and it is the one that was measured rather than
    // asserted (`scripts/compare-parsers.ts` found the LLM added no topic-level
    // information). The LLM's skill-level fields are untouched — that comparison is a
    // formatting job it does well.
    if (parserGaps.length > 0) {
      gapMatrix.recommended_focus_areas = parserGaps
    }

    const questionPlan: QuestionPlan = mockMode
      ? {
          total_questions: 5,
          distribution: { base_role: 2, jd_specific: 2, resume_specific: 1, gap_questions: 0 },
          planned_questions: [
            { index: 0, category: 'base_role', question_type: 'introduction', question_tags: ['intro'], source_hint: 'Start with background' },
            { index: 1, category: 'jd_specific', question_type: 'technical', question_tags: ['react', 'javascript'], source_hint: 'Test core skills' },
            { index: 2, category: 'resume_specific', question_type: 'behavioral', question_tags: ['collaboration'], source_hint: 'Team experience' },
            { index: 3, category: 'jd_specific', question_type: 'technical', question_tags: ['architecture'], source_hint: 'System design' },
            { index: 4, category: 'base_role', question_type: 'closing', question_tags: ['questions'], source_hint: 'Closing' },
          ],
        }
      : await (await getAIProvider()).generateQuestionPlan({
          session_id: '',
          round_type,
          company_name: companyName,
          role_name: roleName,
          resume_text: resumeText,
          jd_text: jdText,
          gap_matrix: gapMatrix,
          conversation_history: [],
          claims_history: [],
        })

    const baseContext: Omit<InterviewContext, 'question_plan' | 'current_question_index'> = {
      session_id: '',
      round_type,
      company_name: companyName,
      role_name: roleName,
      resume_text: resumeText,
      jd_text: jdText,
      gap_matrix: gapMatrix,
      conversation_history: [],
      claims_history: [],
    }

    // Create session
    const { data: session, error: sessionError } = await db
      .from('sessions')
      .insert({
        user_id: userId,
        resume_id: activeResumeId ?? null,
        jd_id: jd_id ?? null,
        mode,
        round_type,
        status: 'in_progress',
        question_plan: questionPlan,
        gap_matrix: gapMatrix,
        claims_history: [],
      })
      .select()
      .single()

    if (sessionError || !session) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: sessionError?.message ?? 'Failed to create session' },
        { status: 500 }
      )
    }

    const fullContext: InterviewContext = {
      ...baseContext,
      session_id: session.id,
      question_plan: questionPlan,
      current_question_index: 0,
    }

    const firstQuestion = mockMode
      ? {
          content: `Hi! I'm your interviewer today for the ${roleName} role at ${companyName}. Let's start — can you walk me through your background and what drew you to this role?`,
          question_type: 'base_role',
          question_tags: ['intro', 'background'],
          follow_up_trigger: false,
          reasoning: 'Mock mode — opening question',
        }
      : await (await getAIProvider()).generateQuestion(fullContext)

    await db.from('messages').insert({
      session_id: session.id,
      role: 'interviewer',
      content: firstQuestion.content,
      question_type: firstQuestion.question_type,
      question_tags: firstQuestion.question_tags,
    })

    return NextResponse.json<ApiResponse<{
      session: Session
      first_question: typeof firstQuestion
      gap_matrix: typeof gapMatrix
      question_plan: typeof questionPlan
    }>>({
      data: {
        session: session as Session,
        first_question: firstQuestion,
        gap_matrix: gapMatrix,
        question_plan: questionPlan,
      },
      error: null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Start interview error:', msg)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: msg },
      { status: 500 }
    )
  }
}
