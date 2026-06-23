import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getAIProvider } from '@/lib/ai/router'
import type { ApiResponse, InterviewContext, Session } from '@/types'

const StartInterviewSchema = z.object({
  jd_id: z.string().uuid().optional(),
  resume_id: z.string().uuid().optional(),
  mode: z.enum(['jd_based', 'general', 'custom']),
  round_type: z.enum(['technical', 'founders', 'hr']),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Unauthorized' }, { status: 401 })
    }

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
      const { data: resume } = await supabase
        .from('resumes')
        .select('*')
        .eq('id', resume_id)
        .eq('user_id', user.id)
        .single()
      if (resume) {
        resumeText = resume.parsed_text
        resumeSkills = resume.extracted_skills ?? []
      }
    } else {
      const { data: activeResume } = await supabase
        .from('resumes')
        .select('*')
        .eq('user_id', user.id)
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
      const { data: jd } = await supabase
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

    const ai = await getAIProvider()

    // Build gap matrix
    const gapMatrix = jdText
      ? await ai.buildGapMatrix(resumeSkills, jdText)
      : {
          matched_skills: resumeSkills.slice(0, 5),
          missing_skills: [],
          partial_match_skills: [],
          gap_severity: 'low' as const,
          recommended_focus_areas: ['general technical skills', 'behavioral questions'],
        }

    // Build context without plan
    const baseContext: Omit<InterviewContext, 'question_plan' | 'current_question_index'> = {
      session_id: '', // Will be filled after session creation
      round_type,
      company_name: companyName,
      role_name: roleName,
      resume_text: resumeText,
      jd_text: jdText,
      gap_matrix: gapMatrix,
      conversation_history: [],
      claims_history: [],
    }

    // Generate question plan
    const questionPlan = await ai.generateQuestionPlan(baseContext)

    // Create session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
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
        { data: null, error: 'Failed to create session' },
        { status: 500 }
      )
    }

    // Generate first question
    const fullContext: InterviewContext = {
      ...baseContext,
      session_id: session.id,
      question_plan: questionPlan,
      current_question_index: 0,
    }

    const firstQuestion = await ai.generateQuestion(fullContext)

    // Save first interviewer message
    await supabase.from('messages').insert({
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
    console.error('Start interview error:', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
