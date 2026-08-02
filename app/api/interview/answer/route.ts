import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAIProvider } from '@/lib/ai/router'
import { evaluationToScore, getScorecard, recordAnswer } from '@/lib/kt/store'
import { chooseNextQuestion, type ChoiceState } from '@/lib/ai/chooser'
import { recordChoice, recordOutcome } from '@/lib/rl/experience'
import type { AnswerEvaluation, ApiResponse, InterviewContext, ConversationTurn } from '@/types'

const AnswerSchema = z.object({
  session_id: z.string().uuid(),
  question: z.string().min(1),
  answer: z.string().min(1),
  question_type: z.string(),
  question_tags: z.array(z.string()),
  question_index: z.number().int().min(0),
  // Measured client-side by the interview timer. Optional so that older clients
  // (and the test script) keep working; absent values stay NULL rather than
  // being silently replaced with a fabricated estimate.
  time_taken_seconds: z.number().int().min(0).optional(),
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
    const userId = user?.id ?? '00000000-0000-0000-0000-000000000000'
    const db = bypass ? await createServiceClient() : supabase

    const body = await request.json()
    const parsed = AnswerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: parsed.error.message }, { status: 400 })
    }

    const { session_id, question, answer, question_type, question_tags, question_index, time_taken_seconds } = parsed.data

    // Verify session ownership
    const { data: session } = await db
      .from('sessions')
      .select('*, resumes(*), job_descriptions(*)')
      .eq('id', session_id)
      .eq('user_id', userId)
      .single()

    if (!session) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Session not found' }, { status: 404 })
    }

    // Fetch conversation history
    const { data: messages } = await db
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

    // Evaluate the answer
    // The mock object previously carried fields the rubric never produces
    // (relevance_score, clarity_score, feedback, improvement_areas) and omitted two
    // it does, so mock mode exercised a different shape than production. Typed
    // explicitly now, which is what caught it.
    const evaluation: AnswerEvaluation = mockMode
      ? {
          depth_score: 70,
          star_compliance: 60,
          consistency_flags: [],
          follow_up_worthy: true,
          suggested_follow_up: 'Can you give a specific example?',
          claims_made: [],
          answer_summary: 'Mock summary of the candidate answer.',
          strong_answer_example: 'A strong answer would give a specific example with measurable impact.',
        }
      : await (await getAIProvider()).evaluateAnswer(question, answer, context)

    // Save candidate message with evaluation.
    const candidateRow = {
      session_id,
      role: 'candidate',
      content: answer,
      question_type,
      question_tags,
      answer_evaluation: evaluation,
    }

    const { error: insertError } = await db
      .from('messages')
      .insert({ ...candidateRow, time_taken_seconds: time_taken_seconds ?? null })

    if (insertError) {
      // 42703 = undefined_column: migration 006 has not been applied to this database
      // yet. Losing the timing value is acceptable; losing the answer is not.
      if (insertError.code === '42703' || insertError.code === 'PGRST204') {
        console.warn(
          'messages.time_taken_seconds missing — apply supabase/migrations/006_answer_duration.sql. ' +
          'Saving answer without timing.'
        )
        const { error: retryError } = await db.from('messages').insert(candidateRow)
        if (retryError) throw retryError
      } else {
        throw insertError
      }
    }

    // Update the persistent scorecard (Model 2). Done per answer rather than at
    // session end so that an abandoned interview still leaves the mastery it earned,
    // and so the curriculum controller can read fresh state for the next question.
    const answerScore = evaluationToScore(evaluation)
    const masteryUpdates = await recordAnswer(db, userId, question_tags, answerScore, session_id)

    // Close the transition opened when this question was chosen. Done for every topic
    // the question was tagged with, because a co-tagged question genuinely is evidence
    // about each of them — the same simplification `recordAnswer` makes.
    for (const update of masteryUpdates) {
      await recordOutcome(db, session_id, update.topic, answerScore, update.gain)
    }

    // Update claims history
    const newClaims = [...claimsHistory, ...evaluation.claims_made]
    await db
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

      if (mockMode) {
        const mockQuestions = [
          'Can you walk me through a challenging technical problem you solved recently?',
          'How do you approach debugging a production issue under pressure?',
          'Tell me about a time you disagreed with a teammate. How did you handle it?',
          'How would you design a URL shortener like bit.ly?',
          'Do you have any questions for me?',
        ]
        nextQuestion = {
          content: mockQuestions[Math.min(question_index + 1, mockQuestions.length - 1)],
          question_type: 'technical',
          question_tags: ['mock'],
          follow_up_trigger: false,
          reasoning: 'Mock mode',
        }
      } else if (shouldFollowUp && evaluation.claims_made.length > 0) {
        nextQuestion = await (await getAIProvider()).generateFollowUp(answer, evaluation.claims_made[0], context)
      } else {
        // ── Model 1 decides the topic; the LLM writes the question. ──────────
        //
        // Deliberately not on the follow-up branch above. A follow-up is a reaction to
        // what the candidate just said, and overriding its topic would break the thread
        // of the conversation to satisfy a curriculum — which is exactly the robotic
        // behaviour a human interviewer avoids. The controller resumes on the next
        // planned question.
        const scorecard = await getScorecard(db, userId)
        const state: ChoiceState = {
          mastery: scorecard.mastery,
          attempts: scorecard.attempts,
          // Chronological. Drawn from this session's evaluations, since morale and the
          // failure streak are within-session effects — a bad run last week does not
          // dishearten anyone today, whereas mastery does carry over.
          recentScores: conversationHistory
            .map(turn => (turn.evaluation as AnswerEvaluation | null)?.depth_score)
            .filter((score): score is number => typeof score === 'number')
            .concat(answerScore),
          step: question_index + 1,
          questions: totalQuestions,
        }

        const choice = await chooseNextQuestion(state)
        const nextContext: InterviewContext = {
          ...context,
          current_question_index: question_index + 1,
          // Empty topic means the chooser is disabled; leaving these undefined makes
          // the provider fall through to the static question plan.
          chosen_topic: choice.topic || undefined,
          chosen_difficulty: choice.topic ? choice.difficulty : undefined,
        }
        nextQuestion = await (await getAIProvider()).generateQuestion(nextContext)

        // After the question is generated, not before: a failed generation would
        // otherwise leave a logged decision that never reached the candidate.
        if (choice.topic) {
          await recordChoice(db, userId, session_id, state, choice)
        }
      }

      // Save next interviewer question
      if (nextQuestion) {
        await db.from('messages').insert({
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
      mastery_updates: typeof masteryUpdates
    }>>({
      data: {
        evaluation,
        next_question: nextQuestion,
        is_complete: isComplete,
        next_question_index: isLastQuestion ? question_index : question_index + 1,
        // Empty when migration 007 is not applied or the question carried no
        // recognised tags. The UI treats it as optional for exactly that reason.
        mastery_updates: masteryUpdates,
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
