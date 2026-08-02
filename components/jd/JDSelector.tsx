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
import { CustomJDPanel } from './CustomJDPanel'
import { InterviewBriefModal } from './InterviewBriefModal'
import type { JobDescription, RoundType, RoleType } from '@/types'
import { Search, Shuffle } from 'lucide-react'
import { toast } from 'sonner'

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
  // JDs the user creates in this session are held locally as well as refreshed from the
  // server: `router.refresh()` is not synchronous, and a newly saved JD vanishing from
  // the grid for a moment reads as "it didn't save".
  const [added, setAdded] = useState<JobDescription[]>([])
  const [deleted, setDeleted] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [selectedJD, setSelectedJD] = useState<JobDescription | null>(null)
  const [roundType, setRoundType] = useState<RoundType>('technical')
  const [showBrief, setShowBrief] = useState(false)

  const allJds = useMemo(() => {
    const byId = new Map<string, JobDescription>()
    for (const jd of [...added, ...jds]) if (!byId.has(jd.id)) byId.set(jd.id, jd)
    // Your own JDs sort first — you came here to use the one you just added, not to
    // scroll past twenty seeded ones to find it.
    return [...byId.values()]
      .filter(jd => !deleted.has(jd.id))
      .sort((a, b) => Number(!!b.user_id) - Number(!!a.user_id))
  }, [jds, added, deleted])

  const handleDelete = async (jd: JobDescription) => {
    setDeleted(prev => new Set(prev).add(jd.id))
    const res = await fetch(`/api/jd/custom?id=${encodeURIComponent(jd.id)}`, { method: 'DELETE' })
    const { error } = await res.json()
    if (error) {
      // Put it back rather than leaving the grid disagreeing with the database.
      setDeleted(prev => {
        const next = new Set(prev)
        next.delete(jd.id)
        return next
      })
      toast.error(error)
      return
    }
    toast.success('Job description removed')
    router.refresh()
  }

  const filtered = useMemo(() => {
    return allJds.filter(jd => {
      const matchSearch =
        !search ||
        jd.company_name.toLowerCase().includes(search.toLowerCase()) ||
        jd.role_subtype.toLowerCase().includes(search.toLowerCase()) ||
        jd.required_skills.some(s => s.toLowerCase().includes(search.toLowerCase()))
      const matchRole = roleFilter === 'all' || jd.role_type === roleFilter
      const matchTier = tierFilter === 'all' || jd.company_tier === tierFilter
      return matchSearch && matchRole && matchTier
    })
  }, [allJds, search, roleFilter, tierFilter])

  const handleSurprise = () => {
    if (allJds.length === 0) return
    const random = allJds[Math.floor(Math.random() * allJds.length)]
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
      toast.error(error ?? 'Failed to start session')
      setShowBrief(true) // re-open modal so user can try again
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
        <CustomJDPanel
          onCreated={jd => {
            setAdded(prev => [jd, ...prev])
            // Straight into the brief: the user pasted a specific job because they want
            // to practise for it now, so making them find their own card first is a
            // step with no purpose.
            setSelectedJD(jd)
            setShowBrief(true)
          }}
        />
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
              onDelete={jd.user_id ? () => handleDelete(jd) : undefined}
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
