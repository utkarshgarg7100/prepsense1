'use client'

/**
 * The Knowledge Map — Model 2 made visible.
 *
 * The point of this panel is the sentence it lets a user say: "the system remembers what
 * I am bad at, across sessions." Everything shown here survives between interviews,
 * which is the difference between this project and an LLM wrapper that starts fresh
 * every time.
 *
 * Three deliberate choices:
 *  - **All fifteen topics, always.** A topic never asked about is not missing data; it is
 *    a blind spot, and hiding it would flatter the candidate.
 *  - **Untouched topics are visually distinguished from earned ones.** A default 0.25 and
 *    an earned 0.25 are the same number and completely different facts.
 *  - **Advice comes only from attempted topics.** Telling someone to study their lowest
 *    number when that number is a default is advice built on nothing.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TopicRadar } from './TopicRadar'
import type { KnowledgeMap as KnowledgeMapData, TopicMastery } from '@/app/api/knowledge-map/route'
import {
  Brain, TrendingUp, TrendingDown, Minus, Loader2, Target, Sparkles,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

/** What to actually do about a weak topic. Keyed to the 15-topic taxonomy. */
const STUDY_TIPS: Record<string, string> = {
  'system-design': 'Practise sketching one system end to end — API, data store, cache, failure modes — and say the trade-off you chose out loud.',
  'leadership': 'Prepare two stories where you changed what a group did, and be explicit about what you personally decided.',
  'conflict': 'Have one disagreement story ready that ends in a concrete resolution, not "we agreed to differ".',
  'technical-depth': 'Pick one thing on your CV and go two layers deeper than the summary — why that choice, what broke, what you measured.',
  'behavioral': 'Rehearse in STAR order. Most weak behavioural answers are missing the Result.',
  'product-sense': 'For any product you use, name the user, the job it does, and one metric you would move.',
  'metrics': 'Attach a number to every claim of impact — before, after, and over what period.',
  'communication': 'Answer the question in one sentence first, then explain. Weak answers bury the answer.',
  'ownership': 'Find a story where you carried something past your job description, including the unglamorous part.',
  'problem-solving': 'Talk through your reasoning as you go — interviewers score the approach, not just the answer.',
  'cultural-fit': 'Read the company\'s actual values and have one honest example per value you genuinely share.',
  'resume-probe': 'Assume every line on your CV will be challenged. Be able to defend the weakest one.',
  'gap-probe': 'Name the gap before they do, and say what you are doing about it. Denial scores worse than the gap.',
  'ambiguity': 'Practise starting with clarifying questions and stating your assumptions before you answer.',
  'first-principles': 'Practise deriving an estimate from things you actually know rather than recalling a fact.',
}

function masteryColour(m: number): string {
  if (m >= 0.7) return 'text-emerald-400'
  if (m >= 0.45) return 'text-yellow-400'
  return 'text-rose-400'
}

function barColour(m: number): string {
  if (m >= 0.7) return 'bg-emerald-400'
  if (m >= 0.45) return 'bg-yellow-400'
  return 'bg-rose-400'
}

function TrendIcon({ trend }: { trend: number | null }) {
  // Below 0.01 the arrow would be noise dressed up as a signal.
  if (trend === null || Math.abs(trend) < 0.01) {
    return <Minus className="w-3 h-3 text-slate-600" />
  }
  return trend > 0
    ? <TrendingUp className="w-3 h-3 text-emerald-400" />
    : <TrendingDown className="w-3 h-3 text-rose-400" />
}

function TopicRow({ t }: { t: TopicMastery }) {
  const untouched = t.attempts === 0
  return (
    <div className="flex items-center gap-3">
      <span className={`text-xs w-32 shrink-0 truncate ${untouched ? 'text-slate-500' : 'text-slate-300'}`}>
        {t.label}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${untouched ? 'bg-slate-600' : barColour(t.mastery)}`}
          style={{ width: `${Math.max(2, t.mastery * 100)}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums w-9 text-right ${untouched ? 'text-slate-600' : masteryColour(t.mastery)}`}>
        {Math.round(t.mastery * 100)}
      </span>
      <span className="w-3 shrink-0"><TrendIcon trend={t.trend} /></span>
      {/* An untouched topic is labelled, because a default value that looks like a
          measurement is the most misleading thing this panel could show. */}
      <span className="text-[10px] text-slate-600 w-16 shrink-0">
        {untouched ? 'not asked' : `${t.attempts}×`}
      </span>
    </div>
  )
}

export function KnowledgeMap() {
  const [data, setData] = useState<KnowledgeMapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/knowledge-map')
      .then(r => r.json())
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) setError(error ?? 'Could not load your knowledge map.')
        else setData(data as KnowledgeMapData)
      })
      .catch(() => { if (!cancelled) setError('Could not load your knowledge map.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <Card className="border-white/10 bg-card">
        <CardContent className="py-16 flex items-center justify-center text-slate-500 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your knowledge map…
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className="border-white/10 bg-card">
        <CardContent className="py-10 text-center text-sm text-slate-500">
          {error ?? 'Could not load your knowledge map.'}
        </CardContent>
      </Card>
    )
  }

  // Empty state. Deliberately explains what the map *will* do rather than showing fifteen
  // identical default bars, which would look like a measurement of a person who has not
  // been measured.
  if (!data.has_data) {
    return (
      <Card className="border-white/10 bg-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" /> Knowledge Map
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-8 space-y-4">
          <Sparkles className="w-8 h-8 text-primary/50 mx-auto" />
          <div className="space-y-1.5">
            <p className="text-sm text-slate-300">Your map is empty — no answers recorded yet.</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              As you answer questions, PrepSense tracks how well you know each of 15
              interview topics and <span className="text-slate-400">remembers it between
              sessions</span>. Future interviews then focus on your weakest areas.
            </p>
          </div>
          <Link href="/practice">
            <Button className="bg-primary hover:bg-primary/90 gap-2" size="sm">
              <Target className="w-4 h-4" /> Start your first interview
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  const overallPct = Math.round(data.overall * 100)

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" /> Knowledge Map
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-white/5 text-xs">
                {data.total_attempts} answer{data.total_attempts !== 1 ? 's' : ''} recorded
              </Badge>
              <Badge className={`text-xs bg-white/5 border-white/10 ${masteryColour(data.overall)}`}>
                {overallPct}% overall
              </Badge>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Carried across every session — this is what the interviewer uses to choose your
            next question.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
            <TopicRadar points={data.topics.map(t => ({ label: t.label, value: t.mastery }))} />
            <div className="space-y-2">
              {data.topics.map(t => <TopicRow key={t.topic} t={t} />)}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* What to work on */}
        <Card className="border-white/10 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-rose-400" /> What to work on
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.weakest.map(t => (
              <div key={t.topic} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-200">{t.label}</span>
                  <span className={`text-xs tabular-nums ${masteryColour(t.mastery)}`}>
                    {Math.round(t.mastery * 100)}%
                  </span>
                  {t.attempts === 0 && (
                    <Badge variant="secondary" className="bg-white/5 text-[10px] text-slate-500">
                      never asked
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {STUDY_TIPS[t.topic] ?? 'Practise this area in your next session.'}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Progress over time */}
        <Card className="border-white/10 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> Mastery over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.timeline.length < 2 ? (
              // One point is not a trend, and drawing a line through it would imply one.
              <p className="text-xs text-slate-500 py-8 text-center">
                Come back after another session — a trend needs at least two days of
                answers.
              </p>
            ) : (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.timeline.map(p => ({
                    date: new Date(p.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                    mastery: Math.round(p.mastery * 100),
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} width={28} />
                    <Tooltip
                      formatter={(v) => [`${typeof v === 'number' ? v : 0}%`, 'Mastery']}
                      contentStyle={{
                        background: '#1e293b',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                      }}
                      labelStyle={{ color: '#fff' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="mastery"
                      stroke="oklch(0.623 0.214 263.8)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
