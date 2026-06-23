import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReportView } from '@/components/report/ReportView'

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: session },
    { data: scores },
    { data: messages },
    { data: markers },
    { data: speech },
  ] = await Promise.all([
    supabase
      .from('sessions')
      .select('*, job_descriptions(*), resumes(*)')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase.from('session_scores').select('*').eq('session_id', id).single(),
    supabase.from('messages').select('*').eq('session_id', id).order('timestamp', { ascending: true }),
    supabase.from('resume_markers').select('*').eq('session_id', id),
    supabase.from('speech_feedback').select('*').eq('session_id', id).single(),
  ])

  if (!session) redirect('/history')

  return (
    <ReportView
      session={session}
      scores={scores}
      messages={messages ?? []}
      markers={markers ?? []}
      speech={speech}
    />
  )
}
