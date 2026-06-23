import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InterviewRoom } from '@/components/interview/InterviewRoom'

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && process.env.NEXT_PUBLIC_DEV_BYPASS !== "true") redirect("/login")

  const { data: session } = await supabase
    .from('sessions')
    .select('*, job_descriptions(*), resumes(*)')
    .eq('id', id)
    .eq('user_id', user?.id ?? '')
    .single()

  if (!session) redirect('/practice')
  if (session.status === 'completed') redirect(`/report/${id}`)

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', id)
    .order('timestamp', { ascending: true })

  return (
    <InterviewRoom
      session={session}
      initialMessages={messages ?? []}
      jd={session.job_descriptions}
      questionPlan={session.question_plan}
      gapMatrix={session.gap_matrix}
    />
  )
}
