import { createClient } from '@/lib/supabase/server'
import { JDSelector } from '@/components/jd/JDSelector'
import type { JobDescription } from '@/types'

export default async function PracticePage() {
  const supabase = await createClient()

  const { data: jds } = await supabase
    .from('job_descriptions')
    .select('*')
    .order('company_name', { ascending: true })

  const { data: activeResume } = await supabase
    .from('resumes')
    .select('id, extracted_skills, is_active')
    .eq('is_active', true)
    .single()

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Start a Practice Session</h1>
        <p className="text-slate-400 mt-1">
          Pick a job description, choose your round type, and start your mock interview.
        </p>
      </div>
      <JDSelector jds={(jds ?? []) as JobDescription[]} hasResume={!!activeResume} />
    </div>
  )
}
