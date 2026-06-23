import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BarChart3, Clock, CheckCircle2, XCircle, ArrowRight } from 'lucide-react'

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: sessions } = await supabase
    .from('sessions')
    .select('*, job_descriptions(company_name, role_subtype, company_tier), session_scores(overall_score, communication_score, technical_depth)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const ROUND_COLORS: Record<string, string> = {
    technical: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    founders: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    hr: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Interview History</h1>
        <p className="text-slate-400 text-sm mt-1">{sessions?.length ?? 0} sessions total</p>
      </div>

      {!sessions?.length ? (
        <div className="text-center py-20">
          <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-lg mb-2">No sessions yet</p>
          <p className="text-slate-500 text-sm mb-6">Complete your first practice interview to see it here.</p>
          <Link href="/practice">
            <Button className="bg-primary hover:bg-primary/90">Start Practicing</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(session => {
            const jd = session.job_descriptions as any
            const scores = (session.session_scores as any[])?.[0]
            const isCompleted = session.status === 'completed'

            return (
              <Card key={session.id} className="border-white/10 bg-card hover:border-white/20 transition-colors">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-4">
                    {/* Status icon */}
                    <div className="shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-slate-500" />
                      )}
                    </div>

                    {/* Info */}
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
                            abandoned
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(session.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </span>
                        {session.duration_seconds && (
                          <span className="text-xs text-slate-500">
                            {Math.round(session.duration_seconds / 60)}m
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Score */}
                    {scores?.overall_score != null && (
                      <div className="text-right shrink-0">
                        <div className={`text-2xl font-bold ${
                          scores.overall_score >= 75 ? 'text-emerald-400'
                          : scores.overall_score >= 50 ? 'text-yellow-400'
                          : 'text-rose-400'
                        }`}>
                          {Math.round(scores.overall_score)}
                        </div>
                        <div className="text-xs text-slate-500">/ 100</div>
                      </div>
                    )}

                    {/* CTA */}
                    {isCompleted && (
                      <Link href={`/report/${session.id}`}>
                        <Button size="sm" variant="outline" className="border-white/20 hover:bg-white/10 gap-1.5 shrink-0">
                          Report <ArrowRight className="w-3 h-3" />
                        </Button>
                      </Link>
                    )}
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
