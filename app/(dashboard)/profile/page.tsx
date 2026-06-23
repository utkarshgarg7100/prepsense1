import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ResumeManager } from '@/components/resume/ResumeManager'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: resumes }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('resumes').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
  ])

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <p className="text-slate-400 text-sm mt-1">{user.email}</p>
      </div>

      {/* Profile info */}
      <div className="rounded-xl border border-white/10 bg-card p-5 space-y-3">
        <h2 className="font-semibold text-slate-200">Account</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-500 block text-xs mb-0.5">Full name</span>
            <span className="text-white">{profile?.full_name ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-xs mb-0.5">Experience</span>
            <span className="text-white">{profile?.experience_level ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-xs mb-0.5">Target roles</span>
            <span className="text-white">{profile?.target_roles?.join(', ') ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-xs mb-0.5">Target companies</span>
            <span className="text-white">{profile?.target_companies?.join(', ') ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* Resume management */}
      <ResumeManager
        resumes={resumes ?? []}
        userId={user.id}
      />
    </div>
  )
}
