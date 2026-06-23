'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Brain, ChevronRight, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { ExperienceLevel } from '@/types'

const TARGET_ROLES = [
  'Software Engineer', 'Senior SWE', 'Product Manager', 'Data Scientist',
  'Data Analyst', 'ML Engineer', 'DevOps / SRE', 'Frontend Engineer',
  'Backend Engineer', 'Full Stack Engineer', 'Business Analyst', 'Strategy & Ops',
  'UX Designer', 'Program Manager',
]

const TARGET_COMPANIES = [
  'Google', 'Meta', 'Amazon', 'Microsoft', 'Apple',
  'Flipkart', 'Razorpay', 'PhonePe', 'Swiggy', 'Zomato',
  'CRED', 'Groww', 'Meesho', 'Atlassian', 'Salesforce',
  'Paytm', 'Ola', 'Navi', 'Juspay', 'Zepto',
]

const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string; desc: string }[] = [
  { value: 'fresher', label: 'Fresher', desc: 'Recent graduate or no full-time experience' },
  { value: '1-3yr', label: '1–3 years', desc: 'Early career professional' },
  { value: '3-5yr', label: '3–5 years', desc: 'Mid-level professional' },
  { value: '5yr+', label: '5+ years', desc: 'Senior / leadership roles' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | null>(null)
  const [saving, setSaving] = useState(false)

  const toggle = <T,>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]

  const handleComplete = async () => {
    if (!experienceLevel) { toast.error('Please select your experience level'); return }
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email ?? '',
          full_name: user.user_metadata?.full_name ?? null,
          target_roles: selectedRoles,
          target_companies: selectedCompanies,
          experience_level: experienceLevel,
          onboarding_completed: true,
        }, { onConflict: 'id' })

      if (error) { toast.error('Failed to save preferences'); return }
      router.push('/dashboard')
    } finally {
      setSaving(false)
    }
  }

  const steps = [
    {
      title: 'What roles are you targeting?',
      subtitle: 'Select all that apply — we\'ll personalize your sessions.',
      content: (
        <div className="flex flex-wrap gap-2">
          {TARGET_ROLES.map(role => (
            <button
              key={role}
              onClick={() => setSelectedRoles(toggle(selectedRoles, role))}
              className={`px-4 py-2 rounded-full text-sm border transition-all ${
                selectedRoles.includes(role)
                  ? 'bg-primary border-primary text-white'
                  : 'border-white/20 text-slate-300 hover:border-primary/50'
              }`}
            >
              {selectedRoles.includes(role) && <Check className="w-3 h-3 inline mr-1" />}
              {role}
            </button>
          ))}
        </div>
      ),
      canNext: selectedRoles.length > 0,
    },
    {
      title: 'Which companies interest you?',
      subtitle: 'We\'ll use their culture profiles to prep you.',
      content: (
        <div className="flex flex-wrap gap-2">
          {TARGET_COMPANIES.map(co => (
            <button
              key={co}
              onClick={() => setSelectedCompanies(toggle(selectedCompanies, co))}
              className={`px-4 py-2 rounded-full text-sm border transition-all ${
                selectedCompanies.includes(co)
                  ? 'bg-primary border-primary text-white'
                  : 'border-white/20 text-slate-300 hover:border-primary/50'
              }`}
            >
              {selectedCompanies.includes(co) && <Check className="w-3 h-3 inline mr-1" />}
              {co}
            </button>
          ))}
        </div>
      ),
      canNext: selectedCompanies.length > 0,
    },
    {
      title: 'How much experience do you have?',
      subtitle: 'This helps us calibrate question difficulty.',
      content: (
        <div className="grid grid-cols-1 gap-3">
          {EXPERIENCE_LEVELS.map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() => setExperienceLevel(value)}
              className={`p-4 rounded-xl border text-left transition-all ${
                experienceLevel === value
                  ? 'bg-primary/20 border-primary text-white'
                  : 'border-white/20 text-slate-300 hover:border-primary/50'
              }`}
            >
              <div className="font-semibold">{label}</div>
              <div className="text-sm text-slate-400 mt-1">{desc}</div>
            </button>
          ))}
        </div>
      ),
      canNext: experienceLevel !== null,
    },
  ]

  const current = steps[step]

  return (
    <div className="min-h-screen gradient-bg flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-2xl text-white">PrepSense</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all ${i <= step ? 'bg-primary' : 'bg-white/10'}`}
            />
          ))}
        </div>

        {/* Step indicator */}
        <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
          Step {step + 1} of {steps.length}
        </Badge>

        <h1 className="text-2xl font-bold text-white mb-2">{current.title}</h1>
        <p className="text-slate-400 mb-6">{current.subtitle}</p>

        {/* Content */}
        <div className="mb-8">{current.content}</div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            className="text-slate-400 hover:text-white"
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button
              className="bg-primary hover:bg-primary/90 gap-2"
              onClick={() => setStep(s => s + 1)}
              disabled={!current.canNext}
            >
              Continue <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleComplete}
              disabled={!current.canNext || saving}
            >
              {saving ? 'Saving...' : 'Get started →'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
