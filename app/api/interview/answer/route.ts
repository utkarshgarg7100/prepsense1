import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getAIProvider } from '@/lib/ai/router'
import type { ApiResponse, InterviewContext, ConversationTurn } from '@/types'

const AnswerSchema = z.object({
  session_id: z.string().uuid(),
  question: z.string().min(1),
  answer: z.string().min(1),
  question_type: z.string(),
  question_tags: z.array(z.string()),
  question_index: z.number().int().min(0),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = AnswerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: parsed.error.message }, { status: 400 })
    }

    const { session_id, question, answer, question_type, question_tags, question_index } = parsed.data

    // Verify session ownership
    const { data: session } = await supabase
      .from('sessions')
      .select('*, resumes(*), job_descriptions(*)')
      .eq('id', session_id)
      .eq('user_id', user.id)
      .single()

    if (!session) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Session not found' }, { status: 404 })
    }

    // Fetch conversation history
    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', session_id)
      .order('timestamp', { ascending: true })

    const conversationHistory: ConversationTurn[] = []
    const messageList = messages ?? []

    for (let i = 0; i < messageList.length - 1; i += 2) {
      const q = messageList[i]
      const a = messageList[i + 1]
      if (q && a && q.role === 'interviewer' && a.role === 'candidate') {
        conversationHistory.push({
          question: q.content,
          question_type: q.question_type ?? 'general',
          question_tags: q.question_tags ?? [],
          answer: a.content,
          evaluation: a.answer_evaluation as any ?? null,
        })
      }
    }

    const claimsHistory: string[] = session.claims_history ?? []
    const gapMatrix = session.gap_matrix
    const questionPlan = session.question_plan

    const context: InterviewContext = {
      session_id,
      round_type: session.round_type,
      company_name: session.job_descriptions?.company_name ?? 'the company',
      role_name: session.job_descriptions?.role_subtype ?? 'this role',
      resume_text: session.resumes?.parsed_text ?? '',
      jd_text: session.job_descriptions?.jd_text ?? '',
      gap_matrix: gapMatrix,
      conversation_history: conversationHistory,
      claims_history: claimsHistory,
      question_plan: questionPlan,
      current_question_index: question_index,
    }

    const ai = await getAIProvider()

    // Evaluate the answer
    const evaluation = await ai.evaluateAnswer(question, answer, context)

    // Save candidate message with evaluation
    await supabase.from('messages').insert({
      session_id,
      role: 'candidate',
      content: answer,
      question_type,
      question_tags,
      answer_evaluation: evaluation,
    })

    // Update claims history
    const newClaims = [...claimsHistory, ...evaluation.claims_made]
    await supabase
      .from('sessions')
      .update({ claims_history: newClaims })
      .eq('id', session_id)

    // Determine next question
    const totalQuestions = questionPlan?.total_questions ?? 12
    const isLastQuestion = question_index >= totalQuestions - 1
    let nextQuestion = null
    let isComplete = false

    if (isLastQuestion) {
      isComplete = true
    } else {
      // Decide: follow up or next planned question
      const shouldFollowUp =
        evaluation.follow_up_worthy &&
        evaluation.suggested_follow_up &&
        Math.random() < 0.6 // 60% probability for follow-up

      if (shouldFollowUp && evaluation.claims_made.length > 0) {
        nextQuestion = await ai.generateFollowUp(
          answer,
          evaluation.claims_made[0],
          context
        )
      } else {
        const nextContext = { ...context, current_question_index: question_index + 1 }
        nextQuestion = await ai.generateQuestion(nextContext)
      }

      // Save next interviewer question
      if (nextQuestion) {
        await supabase.from('messages').insert({
          session_id,
          role: 'interviewer',
          content: nextQuestion.content,
          question_type: nextQuestion.question_type,
          question_tags: nextQuestion.question_tags,
        })
      }
    }

    return NextResponse.json<ApiResponse<{
      evaluation: typeof evaluation
      next_question: typeof nextQuestion
      is_complete: boolean
      next_question_index: number
    }>>({
      data: {
        evaluation,
        next_question: nextQuestion,
        is_complete: isComplete,
        next_question_index: isLastQuestion ? question_index : question_index + 1,
      },
      error: null,
    })
  } catch (err) {
    console.error('Answer error:', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
