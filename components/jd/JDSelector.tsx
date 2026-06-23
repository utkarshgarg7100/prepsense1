'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { JDCard } from './JDCard'
import { InterviewBriefModal } from './InterviewBriefModal'
import type { JobDescription, RoundType, RoleType } from '@/types'
import { Search, Shuffle } from 'lucide-react'

const ROLE_TYPES: RoleType[] = [
  'Software Engineering',
  'Product Management',
  'Business & Strategy',
  'Design',
  'Data & Analytics',
  'Operations',
]

interface Props {
  jds: JobDescription[]
  hasResume: boolean
}

export function JDSelector({ jds, hasResume }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [selectedJD, setSelectedJD] = useState<JobDescription | null>(null)
  const [roundType, setRoundType] = useState<RoundType>('technical')
  const [showBrief, setShowBrief] = useState(false)

  const filtered = useMemo(() => {
    return jds.filter(jd => {
      const matchSearch =
        !search ||
        jd.company_name.toLowerCase().includes(search.toLowerCase()) ||
        jd.role_subtype.toLowerCase().includes(search.toLowerCase()) ||
        jd.required_skills.some(s => s.toLowerCase().includes(search.toLowerCase()))
      const matchRole = roleFilter === 'all' || jd.role_type === roleFilter
      const matchTier = tierFilter === 'all' || jd.company_tier === tierFilter
      return matchSearch && matchRole && matchTier
    })
  }, [jds, search, roleFilter, tierFilter])

  const handleSurprise = () => {
    if (jds.length === 0) return
    const random = jds[Math.floor(Math.random() * jds.length)]
    setSelectedJD(random)
    setShowBrief(true)
  }

  const handleSelect = (jd: JobDescription) => {
    setSelectedJD(jd)
    setShowBrief(true)
  }

  const handleStartInterview = async () => {
    if (!selectedJD) return
    setShowBrief(false)

    const res = await fetch('/api/interview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd_id: selectedJD.id,
        mode: 'jd_based',
        round_type: roundType,
      }),
    })

    const { data, error } = await res.json()
    if (error || !data) {
      alert('Failed to start session: ' + (error ?? 'Unknown error'))
      return
    }
    router.push(`/interview/${data.session.id}`)
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search by company, role, or skill..."
            className="pl-10 bg-card border-white/10"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v ?? 'all')}>
          <SelectTrigger className="w-full sm:w-52 bg-card border-white/10">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {ROLE_TYPES.map(r => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={(v) => setTierFilter(v ?? 'all')}>
          <SelectTrigger className="w-full sm:w-48 bg-card border-white/10">
            <SelectValue placeholder="All tiers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="FAANG">FAANG</SelectItem>
            <SelectItem value="Indian Unicorn">Indian Unicorn</SelectItem>
            <SelectItem value="Global MNC">Global MNC</SelectItem>
            <SelectItem value="Series B Startup">Series B Startup</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="border-white/20 hover:bg-white/10 gap-2"
          onClick={handleSurprise}
        >
          <Shuffle className="w-4 h-4" /> Surprise Me
        </Button>
      </div>

      {/* Round selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">Round type:</span>
        {(['technical', 'founders', 'hr'] as RoundType[]).map(r => (
          <button
            key={r}
            onClick={() => setRoundType(r)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              roundType === r
                ? 'bg-primary border-primary text-white'
                : 'border-white/20 text-slate-400 hover:border-primary/50'
            }`}
          >
            {r === 'technical' ? '💻 Technical' : r === 'founders' ? '🚀 Founders' : '🤝 HR'}
          </button>
        ))}
      </div>

      {/* No resume warning */}
      {!hasResume && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300 flex items-center gap-2">
          <span>⚠️</span>
          <span>
            You don&apos;t have an active resume. Interviews will use general questions.{' '}
            <a href="/profile" className="underline hover:text-yellow-200">Upload a resume →</a>
          </span>
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-white/5">
          {filtered.length} role{filtered.length !== 1 ? 's' : ''} found
        </Badge>
      </div>

      {/* JD Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p className="text-lg mb-2">No roles match your filters</p>
          <p className="text-sm">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(jd => (
            <JDCard
              key={jd.id}
              jd={jd}
              onSelect={() => handleSelect(jd)}
              isSelected={selectedJD?.id === jd.id}
            />
          ))}
        </div>
      )}

      {/* Brief Modal */}
      {showBrief && selectedJD && (
        <InterviewBriefModal
          jd={selectedJD}
          roundType={roundType}
          onStart={handleStartInterview}
          onClose={() => setShowBrief(false)}
        />
      )}
    </div>
  )
}
