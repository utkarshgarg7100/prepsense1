import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Play, PlayCircle, Trophy, TrendingUp, Flame, Target, ArrowRight } from 'lucide-react'
import { ProgressChart } from '@/components/dashboard/ProgressChart'
import { BadgeGrid } from '@/components/dashboard/BadgeGrid'
import { WeakAreaPanel } from '@/components/dashboard/WeakAreaPanel'
import { KnowledgeMap } from '@/components/knowledge/KnowledgeMap'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && process.env.NEXT_PUBLIC_DEV_BYPASS !== 'true') return null

  const uid = user?.id ?? ''
  const [
    { data: profile },
    { data: sessions },
    { data: streak },
    { data: achievements },
    { data: weakAreas },
    { data: scores },
    { data: paused },
  ] = uid ? await Promise.all([
    supabase.from('profiles').select('*').eq('id', uid).single(),
    supabase
      .from('sessions')
      .select('*, session_scores(*), job_descriptions(company_name, role_subtype)')
      .eq('user_id', uid)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10),
    supabase.from('user_streaks').select('*').eq('user_id', uid).single(),
    supabase
      .from('user_achievements')
      .select('*, badges(*)')
      .eq('user_id', uid)
      .order('earned_at', { ascending: false })
      .limit(6),
    supabase
      .from('user_weak_areas')
      .select('*')
      .eq('user_id', uid)
      .order('avg_score', { ascending: true })
      .limit(5),
    supabase
      .from('session_scores')
      .select('overall_score, created_at, sessions(round_type)')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(10),
    // Interviews left open. Answers are persisted per question, so an `in_progress`
    // row is genuinely resumable — but until now nothing in the UI led back to one,
    // so a session left mid-way was invisible and effectively lost.
    supabase
      .from('sessions')
      .select('id, round_type, created_at, job_descriptions(company_name, role_subtype)')
      .eq('user_id', uid)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .limit(3),
  ]) : [
    { data: null }, { data: [] }, { data: null },
    { data: [] }, { data: [] }, { data: [] }, { data: [] },
  ]

  const completedCount = sessions?.length ?? 0
  const avgScore = sessions?.length
    ? Math.round(
        (sessions ?? []).reduce((acc, s) => acc + (s.session_scores?.[0]?.overall_score ?? 0), 0) / sessions.length
      )
    : 0
  const bestScore = sessions?.length
    ? Math.max(...(sessions ?? []).map(s => s.session_scores?.[0]?.overall_score ?? 0))
    : 0
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hey, {firstName} 👋</h1>
          <p className="text-slate-400 mt-1">
            {completedCount === 0
              ? 'Ready to start your first mock interview?'
              : `You've completed ${completedCount} session${completedCount !== 1 ? 's' : ''}. Keep going!`}
          </p>
        </div>
        <Link href="/practice">
          <Button className="bg-primary hover:bg-primary/90 gap-2">
            <Play className="w-4 h-4" /> New Interview
          </Button>
        </Link>
      </div>

      {/* Resume an interview left open. Placed above the stats because it is the only
          time-sensitive thing on this page — an unfinished interview is work already
          done that is one click from being continued. */}
      {(paused ?? []).length > 0 && (
        <div className="space-y-2">
          {(paused ?? []).map(session => {
            // PostgREST types an embedded relation as an array even when it resolves to
            // at most one row, so it is narrowed here rather than at each use.
            const jd = Array.isArray(session.job_descriptions)
              ? session.job_descriptions[0]
              : session.job_descriptions
            return (
            <Link key={session.id} href={`/interview/${session.id}`} className="block">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 hover:bg-primary/15 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <PlayCircle className="w-5 h-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      Continue your {session.round_type} interview
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {jd?.company_name ?? 'General'}
                      {jd?.role_subtype ? ` — ${jd.role_subtype}` : ''}
                      {' · started '}
                      {new Date(session.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button size="sm" className="bg-primary hover:bg-primary/90 shrink-0">
                  Resume
                </Button>
              </div>
            </Link>
            )
          })}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            icon: Flame,
            label: 'Current Streak',
            value: `${streak?.current_streak ?? 0} days`,
            color: 'text-orange-400',
            bg: 'bg-orange-400/10',
          },
          {
            icon: Target,
            label: 'Sessions Done',
            value: completedCount,
            color: 'text-blue-400',
            bg: 'bg-blue-400/10',
          },
          {
            icon: TrendingUp,
            label: 'Avg Score',
            value: avgScore > 0 ? `${avgScore}/100` : '—',
            color: 'text-emerald-400',
            bg: 'bg-emerald-400/10',
          },
          {
            icon: Trophy,
            label: 'Best Score',
            value: bestScore > 0 ? `${bestScore}/100` : '—',
            color: 'text-yellow-400',
            bg: 'bg-yellow-400/10',
          },
        ].map(({ icon: Icon, label, value, color, bg }) => (
          <Card key={label} className="border-white/10 bg-card">
            <CardContent className="pt-5 pb-4">
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-sm text-slate-400 mt-0.5">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Knowledge Map (Model 2).
          Placed above the per-session widgets on purpose: everything below this line
          describes individual interviews, while this is the only thing on the page that
          persists across all of them. It is the product's central claim, so it should not
          be something the user has to scroll to find. */}
      <KnowledgeMap />

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Progress chart */}
        <div className="lg:col-span-2">
          <Card className="border-white/10 bg-card h-full">
            <CardHeader>
              <CardTitle className="text-base">Score Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {(scores?.length ?? 0) > 0 ? (
                <ProgressChart scores={scores ?? []} />
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-slate-500">
                  <TrendingUp className="w-12 h-12 mb-3 opacity-30" />
                  <p>Complete your first interview to see your progress</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Weak areas */}
        <div>
          <Card className="border-white/10 bg-card h-full">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Focus Areas</CardTitle>
              <Link href="/practice">
                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white h-7 px-2">
                  Practice <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {(weakAreas?.length ?? 0) > 0 ? (
                <WeakAreaPanel areas={weakAreas ?? []} />
              ) : (
                <div className="text-slate-500 text-sm text-center py-8">
                  Complete interviews to identify your weak areas
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Badges + Recent sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Badges */}
        <Card className="border-white/10 bg-card">
          <CardHeader>
            <CardTitle className="text-base">Recent Achievements</CardTitle>
          </CardHeader>
          <CardContent>
            {(achievements?.length ?? 0) > 0 ? (
              <BadgeGrid achievements={achievements ?? []} />
            ) : (
              <div className="text-slate-500 text-sm text-center py-8">
                Complete sessions to earn badges
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent sessions */}
        <Card className="border-white/10 bg-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Sessions</CardTitle>
            <Link href="/history">
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white h-7 px-2">
                All <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {(sessions?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {(sessions ?? []).slice(0, 5).map(session => {
                  const score = session.session_scores?.[0]?.overall_score ?? null
                  const roundColors: Record<string, string> = {
                    technical: 'bg-blue-500/20 text-blue-400',
                    founders: 'bg-purple-500/20 text-purple-400',
                    hr: 'bg-emerald-500/20 text-emerald-400',
                  }
                  return (
                    <Link key={session.id} href={`/report/${session.id}`}>
                      <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {session.job_descriptions?.company_name ?? 'General'} — {session.job_descriptions?.role_subtype ?? 'Interview'}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge className={`text-xs px-1.5 py-0 ${roundColors[session.round_type] ?? ''}`}>
                              {session.round_type}
                            </Badge>
                            <span className="text-xs text-slate-500">
                              {new Date(session.completed_at ?? session.started_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className={`text-lg font-bold tabular-nums ${
                          (score ?? 0) >= 75 ? 'text-emerald-400'
                          : (score ?? 0) >= 50 ? 'text-yellow-400'
                          : 'text-rose-400'
                        }`}>
                          {score ?? '—'}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="text-slate-500 text-sm text-center py-8">
                No sessions yet.{' '}
                <Link href="/practice" className="text-primary hover:underline">
                  Start your first one →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
