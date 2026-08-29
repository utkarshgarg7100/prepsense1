import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { HistoryList, type HistorySession } from '@/components/history/HistoryList'

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && process.env.NEXT_PUBLIC_DEV_BYPASS !== 'true') redirect('/login')

  // `sessions` has no `created_at` — it is `started_at`, and the duration column is
  // `total_duration_seconds`. Ordering by the wrong name made Postgres reject the whole
  // query; the error was discarded and the page rendered its empty state, so six real
  // interviews looked like none. Hence `error` is read below rather than ignored: a
  // failed query and a new account must not look identical.
  const { data, error } = user
    ? await supabase
        .from('sessions')
        .select(
          'id, round_type, status, started_at, completed_at, total_duration_seconds,' +
          ' job_descriptions(company_name, role_subtype),' +
          ' session_scores(overall_score)'
        )
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(50)
    : { data: [], error: null }

  const sessions = (data ?? []) as unknown as HistorySession[]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Interview History</h1>
        <p className="text-slate-400 text-sm mt-1">
          Every practice interview, with its transcript and analysis.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
          <p className="text-sm font-medium text-rose-300">Could not load your interviews.</p>
          <p className="text-xs text-rose-300/80 mt-1">{error.message}</p>
        </div>
      ) : (
        <HistoryList sessions={sessions} />
      )}
    </div>
  )
}
