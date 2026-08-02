/**
 * GET /api/knowledge-map — the candidate's scorecard (Model 2), for display.
 *
 * This is the endpoint that makes the project's central claim visible. Everything else
 * in the app is scoped to one interview; `knowledge_state` is scoped to the person, so
 * answering well on leadership in March still counts in April. Until now the only way
 * to see that was to open the database.
 *
 * Read-only and derived entirely from what the answer route already writes — nothing
 * here recomputes BKT. A second implementation of the update rule in the read path is
 * exactly what the parity tests exist to prevent.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_TOPICS, DEFAULT_PARAMS } from '@/lib/kt/bkt'
import type { ApiResponse } from '@/types'

export interface TopicMastery {
  topic: string
  label: string
  mastery: number
  attempts: number
  /** 'parser' = still the CV-derived guess; 'observed' = earned by answering. */
  seeded_from: string
  /** Mastery change since the earliest recorded point, or null with no history. */
  trend: number | null
}

export interface KnowledgeMap {
  topics: TopicMastery[]
  /** Mean mastery across all 15 topics — one number for "how ready am I". */
  overall: number
  weakest: TopicMastery[]
  strongest: TopicMastery[]
  /** Mean mastery per day, oldest first. Empty until migration 011 has data. */
  timeline: Array<{ date: string; mastery: number }>
  /** Answers that have moved the scorecard. Zero means nothing has been earned yet. */
  total_attempts: number
  /** False when the user has never answered a question — drives the empty state. */
  has_data: boolean
}

/** Topic slugs are for the policy and the database; people need words. */
const TOPIC_LABELS: Record<string, string> = {
  'system-design': 'System Design',
  'leadership': 'Leadership',
  'conflict': 'Conflict',
  'technical-depth': 'Technical Depth',
  'behavioral': 'Behavioural',
  'product-sense': 'Product Sense',
  'metrics': 'Metrics',
  'communication': 'Communication',
  'ownership': 'Ownership',
  'problem-solving': 'Problem Solving',
  'cultural-fit': 'Cultural Fit',
  'resume-probe': 'Resume Depth',
  'gap-probe': 'Known Gaps',
  'ambiguity': 'Ambiguity',
  'first-principles': 'First Principles',
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Unauthorized' }, { status: 401 })
    }

    const [stateResult, historyResult] = await Promise.all([
      supabase
        .from('knowledge_state')
        .select('topic, mastery, attempts, seeded_from')
        .eq('user_id', user.id),
      // Only 'observed' rows. A 'parser' row is the starting guess from the CV, and
      // charting it as progress would show the candidate improving before they answered
      // a single question.
      supabase
        .from('knowledge_history')
        .select('topic, mastery, created_at')
        .eq('user_id', user.id)
        .eq('source', 'observed')
        .order('created_at', { ascending: true })
        .limit(2000),
    ])

    // Both tables degrade rather than fail: a user who has never interviewed has no rows,
    // and that is an empty state, not an error.
    const stateRows = stateResult.data ?? []
    const historyRows = historyResult.data ?? []

    const byTopic = new Map(stateRows.map(r => [r.topic as string, r]))

    // Earliest observed mastery per topic, for the trend arrow.
    const firstSeen = new Map<string, number>()
    for (const row of historyRows) {
      if (!firstSeen.has(row.topic as string)) firstSeen.set(row.topic as string, row.mastery as number)
    }

    // Always all fifteen, in the canonical order. A topic with no row is not missing
    // data — it is a topic the candidate has never been asked about, which is itself
    // worth seeing, and DEFAULT_TOPICS is the ordering the policy's action space uses.
    const topics: TopicMastery[] = DEFAULT_TOPICS.map(topic => {
      const row = byTopic.get(topic)
      const mastery = (row?.mastery as number) ?? DEFAULT_PARAMS.p_init
      const first = firstSeen.get(topic)
      return {
        topic,
        label: TOPIC_LABELS[topic] ?? topic,
        mastery,
        attempts: (row?.attempts as number) ?? 0,
        seeded_from: (row?.seeded_from as string) ?? 'default',
        trend: first === undefined ? null : mastery - first,
      }
    })

    const totalAttempts = topics.reduce((sum, t) => sum + t.attempts, 0)
    const overall = topics.reduce((sum, t) => sum + t.mastery, 0) / topics.length

    // Weakest is computed over *attempted* topics when there are any. A topic sitting at
    // its untouched default is not evidence of weakness, and telling someone to study
    // their lowest number when that number is a default is advice built on nothing.
    const attempted = topics.filter(t => t.attempts > 0)
    const ranked = (attempted.length >= 3 ? attempted : topics)
      .slice()
      .sort((a, b) => a.mastery - b.mastery)

    // One point per day: several answers on the same day are one sitting, and plotting
    // each of them makes a session look like a trend.
    const byDay = new Map<string, { sum: number; n: number }>()
    for (const row of historyRows) {
      const date = new Date(row.created_at as string).toISOString().slice(0, 10)
      const acc = byDay.get(date) ?? { sum: 0, n: 0 }
      acc.sum += row.mastery as number
      acc.n += 1
      byDay.set(date, acc)
    }
    const timeline = [...byDay.entries()]
      .map(([date, { sum, n }]) => ({ date, mastery: sum / n }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json<ApiResponse<KnowledgeMap>>({
      data: {
        topics,
        overall,
        weakest: ranked.slice(0, 3),
        strongest: ranked.slice(-3).reverse(),
        timeline,
        total_attempts: totalAttempts,
        has_data: totalAttempts > 0,
      },
      error: null,
    })
  } catch (err) {
    console.error('Knowledge map error:', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: 'Could not load your knowledge map.' },
      { status: 500 }
    )
  }
}
