'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { TopicRadar } from '@/components/knowledge/TopicRadar'
import {
  ArrowLeft, Star, Mic, Target, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
} from 'lucide-react'
import type { Message } from '@/types'
import { ScoreBreakdownPanel } from './ScoreBreakdown'

interface Props {
  session: any
  scores: any | null
  messages: Message[]
  markers: any[]
  speech: any | null
}

const SCORE_LABELS: Record<string, string> = {
  overall_score: 'Overall',
  communication_score: 'Communication',
  technical_depth: 'Technical Depth',
  star_compliance: 'STAR Format',
  ownership_signals: 'Ownership',
  conciseness: 'Conciseness',
  consistency_score: 'Consistency',
  cultural_fit: 'Cultural Fit',
  problem_solving: 'Problem Solving',
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 75 ? 'bg-emerald-500'
    : value >= 50 ? 'bg-yellow-500'
    : 'bg-rose-500'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className={`font-semibold ${
          value >= 75 ? 'text-emerald-400' : value >= 50 ? 'text-yellow-400' : 'text-rose-400'
        }`}>{Math.round(value)}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function MessageThread({ messages }: { messages: Message[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  return (
    <div className="space-y-3">
      {messages.map((msg, i) => {
        const isExpanded = expandedIds.has(msg.id ?? String(i))
        const eval_ = msg.answer_evaluation as any

        if (msg.role === 'interviewer') {
          return (
            <div key={msg.id ?? i} className="bg-white/5 rounded-xl p-3 text-sm text-slate-300 border border-white/10">
              <span className="text-xs text-slate-500 font-semibold block mb-1">Interviewer</span>
              {msg.content}
            </div>
          )
        }

        return (
          <div key={msg.id ?? i} className="ml-4 bg-primary/10 rounded-xl p-3 border border-primary/20">
            <span className="text-xs text-slate-500 font-semibold block mb-1">You</span>
            <p className="text-sm text-slate-300">{msg.content}</p>
            {eval_ && (
              <div className="mt-2">
                <button
                  onClick={() => setExpandedIds(prev => {
                    const next = new Set(prev)
                    const key = msg.id ?? String(i)
                    next.has(key) ? next.delete(key) : next.add(key)
                    return next
                  })}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {isExpanded ? 'Hide' : 'Show'} AI feedback
                </button>
                {isExpanded && (
                  <div className="mt-2 space-y-2 text-xs text-slate-400 border-t border-white/10 pt-2">
                    <div className="flex gap-4">
                      <span>Depth: <b className="text-white">{eval_.depth_score}</b></span>
                      <span>STAR: <b className="text-white">{eval_.star_compliance}</b></span>
                      {eval_.filler_word_count > 0 && (
                        <span className="text-yellow-400">Fillers: {eval_.filler_word_count}</span>
                      )}
                    </div>

                    {/* Why those two numbers are what they are. */}
                    <ScoreBreakdownPanel
                      breakdown={eval_.score_breakdown}
                      starScore={eval_.star_compliance}
                      depthScore={eval_.depth_score}
                    />
                    {eval_.strengths?.length > 0 && (
                      <div>
                        <span className="text-emerald-400 font-semibold">Strengths:</span>
                        <ul className="list-disc list-inside mt-0.5 space-y-0.5">
                          {eval_.strengths.map((s: string, j: number) => <li key={j}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {eval_.improvements?.length > 0 && (
                      <div>
                        <span className="text-rose-400 font-semibold">Improvements:</span>
                        <ul className="list-disc list-inside mt-0.5 space-y-0.5">
                          {eval_.improvements.map((s: string, j: number) => <li key={j}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {eval_.strong_answer_example && (
                      <div className="bg-white/5 rounded p-2 text-slate-300 italic">
                        &ldquo;{eval_.strong_answer_example}&rdquo;
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ReportView({ session, scores, messages, markers, speech }: Props) {
  const jd = session.job_descriptions
  const overall = scores?.overall_score ?? 0

  // Shares `TopicRadar` with the dashboard's knowledge map. The two show different
  // things — these are six rubric dimensions from *this* session, the map shows fifteen
  // persistent topic masteries — so the component takes generic labelled points and each
  // caller supplies the meaning. Values are divided by 100 because `TopicRadar` works in
  // the 0–1 probability space the scorecard uses.
  const radarData = scores ? [
    { label: 'Communication', value: (scores.communication_score ?? 0) / 100 },
    { label: 'Technical', value: (scores.technical_depth ?? 0) / 100 },
    { label: 'STAR', value: (scores.star_compliance ?? 0) / 100 },
    { label: 'Ownership', value: (scores.ownership_signals ?? 0) / 100 },
    { label: 'Conciseness', value: (scores.conciseness ?? 0) / 100 },
    { label: 'Consistency', value: (scores.consistency_score ?? 0) / 100 },
  ] : []

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/history">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5">
            <ArrowLeft className="w-4 h-4" /> History
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">
            {jd?.company_name ?? 'General'} — {jd?.role_subtype ?? 'Interview'}
          </h1>
          <p className="text-sm text-slate-400">
            {new Date(session.created_at).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'long', year: 'numeric',
            })} · {session.round_type} round
            {session.duration_seconds ? ` · ${Math.round(session.duration_seconds / 60)}m` : ''}
          </p>
        </div>
        <Link href="/practice">
          <Button className="bg-primary hover:bg-primary/90 gap-2">
            <Target className="w-4 h-4" /> Practice Again
          </Button>
        </Link>
      </div>

      {/* Overall score hero */}
      {scores && (
        <Card className="border-white/10 bg-card">
          <CardContent className="pt-6 pb-6">
            <div className="flex flex-col md:flex-row items-center gap-8">
              {/* Big score */}
              <div className="text-center">
                <div className={`text-7xl font-bold ${
                  overall >= 75 ? 'text-emerald-400' : overall >= 50 ? 'text-yellow-400' : 'text-rose-400'
                }`}>
                  {Math.round(overall)}
                </div>
                <div className="text-slate-400 text-sm mt-1">Overall Score</div>
                {scores.percentile && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    Top {100 - Math.round(scores.percentile)}% of candidates
                  </div>
                )}
              </div>

              {/* Radar chart */}
              <div className="flex-1">
                <TopicRadar points={radarData} height={208} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Score breakdown */}
        {scores && (
          <Card className="border-white/10 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-400" /> Score Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(SCORE_LABELS).map(([key, label]) => {
                const val = scores[key]
                if (val == null) return null
                return <ScoreBar key={key} label={label} value={val} />
              })}
            </CardContent>
          </Card>
        )}

        {/* Speech feedback */}
        {speech && (
          <Card className="border-white/10 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <Mic className="w-4 h-4 text-blue-400" /> Speech Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {speech.words_per_minute && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Speaking pace</span>
                  <span className="text-white font-semibold">{speech.words_per_minute} WPM
                    <span className="text-slate-500 text-xs ml-1">
                      {speech.words_per_minute < 120 ? '(slow)' : speech.words_per_minute > 160 ? '(fast)' : '(good)'}
                    </span>
                  </span>
                </div>
              )}
              {speech.filler_word_count != null && (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Filler words</span>
                    <span className={`font-semibold ${
                      speech.filler_confidence === 'understated' ? 'text-slate-400'
                      : speech.filler_word_count > 10 ? 'text-rose-400'
                      : 'text-emerald-400'
                    }`}>
                      {speech.filler_word_count}
                      {speech.filler_confidence === 'understated' && '+'}
                    </span>
                  </div>
                  {speech.filler_confidence === 'understated' && (
                    <p className="text-xs text-slate-500">
                      Typed answers, or a transcript with hesitations removed — treat this
                      as a floor. Answer by voice for a real filler count.
                    </p>
                  )}
                </div>
              )}
              {speech.avg_answer_length && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg answer length</span>
                  <span className="text-white font-semibold">{speech.avg_answer_length} words</span>
                </div>
              )}
              {speech.top_filler_words?.length > 0 && (
                <div>
                  <span className="text-slate-400 block mb-1">Common fillers:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {speech.top_filler_words.map((w: string) => (
                      <Badge key={w} className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-xs">{w}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {speech.coaching_tips?.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-white/10">
                  {speech.coaching_tips.map((tip: string, i: number) => (
                    <p key={i} className="text-xs text-slate-400 flex gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      {tip}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Resume markers */}
        {markers.length > 0 && (
          <Card className="border-white/10 bg-card md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" /> Resume Claim Verification
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {markers.map((m: any, i: number) => (
                  <div key={i} className={`rounded-lg px-3 py-2 border text-sm flex gap-2 ${
                    m.marker_type === 'verified'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                      : m.marker_type === 'exaggerated'
                      ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                      : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
                  }`}>
                    <span>{m.marker_type === 'verified' ? '✅' : m.marker_type === 'exaggerated' ? '❌' : '⚠️'}</span>
                    <div>
                      <span className="font-semibold">{m.claim}</span>
                      {m.explanation && <p className="text-xs opacity-80 mt-0.5">{m.explanation}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Session report */}
      {session.session_report && (
        <Card className="border-white/10 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-200">AI Coaching Report</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300 leading-relaxed space-y-4">
            {typeof session.session_report === 'string'
              ? session.session_report.split('\n').filter(Boolean).map((p: string, i: number) => (
                  <p key={i}>{p}</p>
                ))
              : <p>{JSON.stringify(session.session_report)}</p>
            }
          </CardContent>
        </Card>
      )}

      {/* Conversation replay */}
      <Card className="border-white/10 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-slate-200">Conversation Replay</CardTitle>
        </CardHeader>
        <CardContent>
          <MessageThread messages={messages} />
        </CardContent>
      </Card>
    </div>
  )
}
