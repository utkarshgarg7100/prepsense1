import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAIProvider } from '@/lib/ai/router'
import {
  aggregateScoresForRound,
  computeSpeechMetrics,
  countFillerWords,
} from '@/lib/scoring'
import type { ApiResponse, AnswerEvaluation, RoundType } from '@/types'
import type { SessionData } from '@/lib/ai/types'

const CompleteSchema = z.object({
  session_id: z.string().uuid(),
  duration_seconds: z.number().int().positive(),
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
    const parsed = CompleteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: parsed.error.message }, { status: 400 })
    }

    const { session_id, duration_seconds } = parsed.data

    const { data: session } = await db
      .from('sessions')
      .select('*, resumes(*), job_descriptions(*)')
      .eq('id', session_id)
      .eq('user_id', userId)
      .single()

    if (!session) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Session not found' }, { status: 404 })
    }

    // Fetch all messages
    const { data: messages } = await db
      .from('messages')
      .select('*')
      .eq('session_id', session_id)
      .order('timestamp', { ascending: true })

    const candidateMessages = (messages ?? []).filter(m => m.role === 'candidate')
    const answers = candidateMessages.map(m => m.content)
    const evaluations = candidateMessages
      .map(m => m.answer_evaluation)
      .filter((e): e is AnswerEvaluation => e !== null)

    // Compute scores
    const rawScores = aggregateScoresForRound(evaluations, session.round_type as RoundType, answers)

    // Compute speech metrics. Prefer the timer value measured in the interview UI;
    // fall back to a word-count estimate only for answers recorded before the
    // `time_taken_seconds` column existed (or by clients that don't send it).
    const durations = candidateMessages.map(m => {
      const measured = m.time_taken_seconds
      if (typeof measured === 'number' && measured > 0) return measured
      const wc = m.content.split(/\s+/).filter(Boolean).length
      return Math.round(wc * 0.4) // ~0.4s per word average
    })
    const speechMetrics = computeSpeechMetrics(answers, durations)

    // Compute percentile (simplified)
    const percentile = Math.min(99, Math.max(1, Math.round(((rawScores.overall_score ?? 0) - 40) * 2)))

    const finalScores = { ...rawScores, percentile }

    // Save session scores. This is the point of the whole route — if it fails the
    // report page has nothing to render, so fail loudly rather than redirecting the
    // user to a blank report.
    const { error: scoreError } = await db.from('session_scores').upsert({
      session_id,
      user_id: userId,
      ...finalScores,
      custom_metrics: {},
    })

    if (scoreError) {
      console.error('Failed to save session scores:', scoreError)
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: `Failed to save scores: ${scoreError.message}` },
        { status: 500 }
      )
    }

    // Save speech feedback. Non-fatal: the report degrades gracefully without it.
    const { error: speechError } = await db.from('speech_feedback').upsert({
      session_id,
      ...speechMetrics,
    })
    if (speechError) console.error('Failed to save speech feedback:', speechError)

    // Mark session completed. Fatal: a session left 'in_progress' will be resumed
    // instead of reported, stranding the user in a finished interview.
    const { error: sessionUpdateError } = await db
      .from('sessions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_duration_seconds: duration_seconds,
      })
      .eq('id', session_id)

    if (sessionUpdateError) {
      console.error('Failed to mark session completed:', sessionUpdateError)
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: `Failed to complete session: ${sessionUpdateError.message}` },
        { status: 500 }
      )
    }

    // Update streak
    const today = new Date().toISOString().split('T')[0]
    const { data: streak } = await db
      .from('user_streaks')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (streak) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      const isConsecutive = streak.last_session_date === yesterday
      const newStreak = isConsecutive ? streak.current_streak + 1 : 1
      await db
        .from('user_streaks')
        .update({
          current_streak: newStreak,
          longest_streak: Math.max(streak.longest_streak, newStreak),
          last_session_date: today,
        })
        .eq('user_id', userId)
    } else {
      await db.from('user_streaks').insert({
        user_id: userId,
        current_streak: 1,
        longest_streak: 1,
        last_session_date: today,
      })
    }

    const transcript: SessionData['transcript'] = []

    const msgList = messages ?? []
    for (let i = 0; i < msgList.length - 1; i += 2) {
      const q = msgList[i]
      const a = msgList[i + 1]
      if (q && a && q.role === 'interviewer' && a.role === 'candidate') {
        transcript.push({
          question: q.content,
          question_type: q.question_type ?? 'general',
          answer: a.content,
          evaluation: a.answer_evaluation as AnswerEvaluation ?? null,
        })
      }
    }

    // Generate session report
    const sessionData: SessionData = {
      session_id,
      round_type: session.round_type,
      company_name: session.job_descriptions?.company_name ?? 'the company',
      role_name: session.job_descriptions?.role_subtype ?? 'this role',
      transcript,
      scores: finalScores,
      gap_matrix: session.gap_matrix,
    }

    const report = mockMode
      ? {
          overall_summary: 'Good performance overall. You demonstrated solid communication skills and answered most questions clearly.',
          strengths: ['Clear communication', 'Structured answers', 'Good enthusiasm for the role'],
          areas_for_improvement: ['Add more quantifiable examples', 'Deeper technical depth on system design', 'More concise answers'],
          question_wise_feedback: transcript.map((t, i) => ({
            question_number: i + 1,
            question: t.question,
            feedback: 'Decent answer. Could be more specific with examples.',
            score: t.evaluation?.depth_score ?? 70,
          })),
          recommended_resources: ['System Design Interview by Alex Xu', 'LeetCode top 150', 'STAR method practice'],
          hiring_likelihood: 'Maybe' as const,
          next_steps: ['Practice system design', 'Prepare 3–5 STAR stories', 'Research the company deeper'],
        }
      : await (await getAIProvider()).generateSessionReport(sessionData)

    // Save resume markers if resume exists (skip in mock mode)
    if (!mockMode && session.resumes?.parsed_text) {
      const ai = await getAIProvider()
      const geminiProvider = ai as any
      if (typeof geminiProvider.generateResumeMarkers === 'function') {
        const markers = await geminiProvider.generateResumeMarkers(
          session.resumes.parsed_text,
          transcript,
          session.job_descriptions?.required_skills ?? []
        )
        if (Array.isArray(markers) && markers.length > 0) {
          await db.from('resume_markers').insert(
            markers.map((m: any) => ({ session_id, ...m }))
          )
        }
      }
    }

    // Award badges
    await checkAndAwardBadges(db, userId, finalScores, session)

    // Update RL weak areas
    await updateWeakAreas(db, userId, evaluations, messages ?? [])

    return NextResponse.json<ApiResponse<{
      scores: typeof finalScores
      report: typeof report
      speech_metrics: typeof speechMetrics
    }>>({
      data: { scores: finalScores, report, speech_metrics: speechMetrics },
      error: null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Complete interview error:', msg)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: msg },
      { status: 500 }
    )
  }
}

async function checkAndAwardBadges(supabase: any, userId: string, scores: any, session: any) {
  const { data: existing } = await supabase
    .from('user_achievements')
    .select('badge_id')
    .eq('user_id', userId)

  const earnedIds = new Set((existing ?? []).map((a: any) => a.badge_id))
  const toAward: string[] = []

  // Count completed sessions
  const { count: sessionCount } = await supabase
    .from('sessions')
    .select('id', { count: 'exact' })
    .eq('user_id', userId)
    .eq('status', 'completed')

  if (!earnedIds.has('first_shot') && sessionCount >= 1) toAward.push('first_shot')

  const { data: streakData } = await supabase
    .from('user_streaks')
    .select('current_streak')
    .eq('user_id', userId)
    .single()

  if (!earnedIds.has('on_fire') && (streakData?.current_streak ?? 0) >= 3) toAward.push('on_fire')
  if (!earnedIds.has('consistent') && (streakData?.current_streak ?? 0) >= 7) toAward.push('consistent')

  if (scores.overall_score >= 85) {
    // Check for mock offer — need 3 rounds
    const roundTypes = ['technical', 'founders', 'hr']
    const { data: roundSessions } = await supabase
      .from('sessions')
      .select('round_type')
      .eq('user_id', userId)
      .eq('status', 'completed')

    const completedRounds = new Set((roundSessions ?? []).map((s: any) => s.round_type))
    if (!earnedIds.has('all_rounder') && completedRounds.size >= 3) toAward.push('all_rounder')
    if (!earnedIds.has('mock_offer') && roundTypes.every(r => completedRounds.has(r))) {
      toAward.push('mock_offer')
    }
  }

  if (!earnedIds.has('top_10_percent') && (scores.percentile ?? 0) >= 90) {
    toAward.push('top_10_percent')
  }

  if (toAward.length > 0) {
    await supabase.from('user_achievements').insert(
      toAward.map(badge_id => ({ user_id: userId, badge_id }))
    )
  }
}

async function updateWeakAreas(supabase: any, userId: string, evaluations: AnswerEvaluation[], messages: any[]) {
  const tagScores: Record<string, number[]> = {}

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'interviewer' && msg.question_tags?.length > 0) {
      const nextMsg = messages[i + 1]
      if (nextMsg?.role === 'candidate' && nextMsg.answer_evaluation) {
        const score = nextMsg.answer_evaluation.depth_score ?? 50
        for (const tag of msg.question_tags) {
          if (!tagScores[tag]) tagScores[tag] = []
          tagScores[tag].push(score)
        }
      }
    }
  }

  for (const [tag, scores] of Object.entries(tagScores)) {
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length

    const { data: existing } = await supabase
      .from('user_weak_areas')
      .select('*')
      .eq('user_id', userId)
      .eq('tag', tag)
      .single()

    if (existing) {
      const newCount = existing.session_count + 1
      const newAvg = (existing.avg_score * existing.session_count + avgScore) / newCount
      const normalizedScore = avgScore / 100
      await supabase
        .from('user_weak_areas')
        .update({
          avg_score: newAvg,
          session_count: newCount,
          last_seen_at: new Date().toISOString(),
          alpha: existing.alpha + normalizedScore,
          beta: existing.beta + (1 - normalizedScore),
        })
        .eq('id', existing.id)
    } else {
      const normalizedScore = avgScore / 100
      await supabase.from('user_weak_areas').insert({
        user_id: userId,
        tag,
        avg_score: avgScore,
        session_count: 1,
        last_seen_at: new Date().toISOString(),
        alpha: 1 + normalizedScore,
        beta: 1 + (1 - normalizedScore),
      })
    }
  }
}
