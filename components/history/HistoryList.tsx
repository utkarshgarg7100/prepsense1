'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  BarChart3, Clock, CheckCircle2, PlayCircle, ArrowRight, Search, Trash2, Loader2,
} from 'lucide-react'

export interface HistorySession {
  id: string
  round_type: string
  status: string
  started_at: string
  completed_at: string | null
  total_duration_seconds: number | null
  job_descriptions: { company_name: string; role_subtype: string } | null
  session_scores: Array<{ overall_score: number | null }> | null
}

const ROUND_COLORS: Record<string, string> = {
  technical: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  founders: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  hr: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
}

type StatusFilter = 'all' | 'completed' | 'in_progress'

function scoreColour(score: number): string {
  return score >= 75 ? 'text-emerald-400' : score >= 50 ? 'text-yellow-400' : 'text-rose-400'
}

export function HistoryList({ sessions }: { sessions: HistorySession[] }) {
  const router = useRouter()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [round, setRound] = useState<string>('all')
  const [query, setQuery] = useState('')
  // Optimistic removal: the row disappears immediately and is restored if the delete
  // fails, rather than leaving the user staring at a row they just deleted.
  const [removed, setRemoved] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)

  const rounds = useMemo(
    () => Array.from(new Set(sessions.map(s => s.round_type))).sort(),
    [sessions]
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions
      .filter(s => !removed.includes(s.id))
      .filter(s => status === 'all' || s.status === status)
      .filter(s => round === 'all' || s.round_type === round)
      .filter(s => {
        if (!q) return true
        const jd = s.job_descriptions
        return (
          (jd?.company_name ?? '').toLowerCase().includes(q) ||
          (jd?.role_subtype ?? '').toLowerCase().includes(q)
        )
      })
  }, [sessions, removed, status, round, query])

  // Stats describe everything, not the current filter — a summary that changes when you
  // type in a search box is a summary of nothing.
  const stats = useMemo(() => {
    const live = sessions.filter(s => !removed.includes(s.id))
    const scored = live
      .map(s => s.session_scores?.[0]?.overall_score)
      .filter((n): n is number => typeof n === 'number')
    return {
      total: live.length,
      completed: live.filter(s => s.status === 'completed').length,
      unfinished: live.filter(s => s.status === 'in_progress').length,
      avg: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
      best: scored.length ? Math.max(...scored) : null,
    }
  }, [sessions, removed])

  async function handleDelete(id: string) {
    if (!confirm('Delete this interview permanently? The transcript and analysis go with it.')) return
    setDeleting(id)
    setRemoved(prev => [...prev, id])
    const { error } = await createClient().from('sessions').delete().eq('id', id)
    setDeleting(null)
    if (error) {
      setRemoved(prev => prev.filter(x => x !== id))
      alert(`Could not delete: ${error.message}`)
      return
    }
    router.refresh()
  }

  if (!sessions.length) {
    return (
      <div className="text-center py-20">
        <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <p className="text-slate-400 text-lg mb-2">No sessions yet</p>
        <p className="text-slate-500 text-sm mb-6">
          Complete your first practice interview to see it here.
        </p>
        <Link href="/practice">
          <Button className="bg-primary hover:bg-primary/90">Start Practicing</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Interviews', value: stats.total },
          { label: 'Completed', value: stats.completed },
          { label: 'Average score', value: stats.avg ?? '—' },
          { label: 'Best score', value: stats.best ?? '—' },
        ].map(s => (
          <Card key={s.label} className="border-white/10 bg-card">
            <CardContent className="py-3">
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.unfinished > 0 && (
        <p className="text-xs text-slate-400">
          {stats.unfinished} unfinished {stats.unfinished === 1 ? 'interview' : 'interviews'} —
          answers are saved per question, so you can pick up where you left off.
        </p>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search company or role"
            className="w-full bg-white/5 border border-white/10 rounded-md pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-white/25"
          />
        </div>

        <div className="flex gap-1">
          {(['all', 'completed', 'in_progress'] as StatusFilter[]).map(s => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? 'default' : 'outline'}
              onClick={() => setStatus(s)}
              className={status === s ? '' : 'border-white/15 hover:bg-white/10'}
            >
              {s === 'all' ? 'All' : s === 'completed' ? 'Completed' : 'Unfinished'}
            </Button>
          ))}
        </div>

        {rounds.length > 1 && (
          <select
            value={round}
            onChange={e => setRound(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-white/25"
          >
            <option value="all">All rounds</option>
            {rounds.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Showing {visible.length} of {stats.total}
      </p>

      {/* Rows */}
      {!visible.length ? (
        <div className="text-center py-14 border border-dashed border-white/10 rounded-lg">
          <p className="text-slate-400 text-sm">No interviews match these filters.</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-white/15 hover:bg-white/10"
            onClick={() => { setStatus('all'); setRound('all'); setQuery('') }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(session => {
            const jd = session.job_descriptions
            const score = session.session_scores?.[0]?.overall_score
            const isCompleted = session.status === 'completed'

            return (
              <Card
                key={session.id}
                className="border-white/10 bg-card hover:border-white/20 transition-colors"
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-4">
                    <div className="shrink-0">
                      {isCompleted
                        ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        : <PlayCircle className="w-5 h-5 text-yellow-400" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm">
                          {jd?.company_name ?? 'General'} — {jd?.role_subtype ?? 'Interview'}
                        </span>
                        <Badge className={`text-xs border ${ROUND_COLORS[session.round_type] ?? 'bg-white/5 text-slate-400'}`}>
                          {session.round_type}
                        </Badge>
                        {!isCompleted && (
                          <Badge className="text-xs bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                            unfinished
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(session.started_at).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </span>
                        {session.total_duration_seconds != null && (
                          <span className="text-xs text-slate-500">
                            {Math.round(session.total_duration_seconds / 60)}m
                          </span>
                        )}
                      </div>
                    </div>

                    {score != null && (
                      <div className="text-right shrink-0">
                        <div className={`text-2xl font-bold ${scoreColour(score)}`}>
                          {Math.round(score)}
                        </div>
                        <div className="text-xs text-slate-500">/ 100</div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 shrink-0">
                      {isCompleted ? (
                        <Link href={`/report/${session.id}`}>
                          <Button size="sm" variant="outline" className="border-white/20 hover:bg-white/10 gap-1.5">
                            Review <ArrowRight className="w-3 h-3" />
                          </Button>
                        </Link>
                      ) : (
                        <Link href={`/interview/${session.id}`}>
                          <Button size="sm" variant="outline" className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 gap-1.5">
                            Continue <ArrowRight className="w-3 h-3" />
                          </Button>
                        </Link>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete interview"
                        disabled={deleting === session.id}
                        onClick={() => handleDelete(session.id)}
                        className="text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        {deleting === session.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
