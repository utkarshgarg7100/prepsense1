'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { JobDescription, RoundType } from '@/types'
import { AlertCircle, CheckCircle2, Target, Play, Loader2 } from 'lucide-react'
import { useState } from 'react'

interface Props {
  jd: JobDescription
  roundType: RoundType
  onStart: () => Promise<void>
  onClose: () => void
}

const DIFFICULTY: Record<string, { label: string; color: string }> = {
  FAANG: { label: 'Hard', color: 'text-rose-400' },
  'Indian Unicorn': { label: 'Medium-Hard', color: 'text-orange-400' },
  'Global MNC': { label: 'Medium', color: 'text-yellow-400' },
  'Series B Startup': { label: 'Medium', color: 'text-yellow-400' },
}

const ROUND_INFO: Record<RoundType, { name: string; interviewer: string; desc: string }> = {
  technical: {
    name: 'Technical Round',
    interviewer: 'Alex (Senior Engineer)',
    desc: 'Expect deep technical questions, system design, and project deep-dives.',
  },
  founders: {
    name: "Founders' Round",
    interviewer: 'Priya (Co-founder & VP)',
    desc: 'Expect first-principles thinking, ownership, and business impact questions.',
  },
  hr: {
    name: 'HR Round',
    interviewer: 'Rohan (People Partner)',
    desc: 'Expect behavioral STAR questions, cultural fit, and career motivation.',
  },
}

export function InterviewBriefModal({ jd, roundType, onStart, onClose }: Props) {
  const [starting, setStarting] = useState(false)
  const round = ROUND_INFO[roundType]
  const difficulty = DIFFICULTY[jd.company_tier] ?? { label: 'Medium', color: 'text-yellow-400' }

  const handleStart = async () => {
    setStarting(true)
    try {
      await onStart()
    } finally {
      setStarting(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg bg-card border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl">Interview Brief</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Company + role */}
          <div className="rounded-xl bg-white/5 p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold">{jd.role_subtype}</h3>
              <Badge className="bg-primary/20 text-primary border-primary/30">{jd.company_tier}</Badge>
            </div>
            <p className="text-sm text-slate-400">{jd.company_name} · {jd.industry}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-slate-500">Difficulty:</span>
              <span className={`text-xs font-semibold ${difficulty.color}`}>{difficulty.label}</span>
            </div>
          </div>

          {/* Round info */}
          <div className="rounded-xl bg-primary/10 border border-primary/20 p-4">
            <h4 className="font-semibold text-primary mb-1">{round.name}</h4>
            <p className="text-xs text-slate-400 mb-1">Interviewer: <span className="text-slate-300">{round.interviewer}</span></p>
            <p className="text-sm text-slate-300">{round.desc}</p>
          </div>

          {/* What this company cares about */}
          <div>
            <h4 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" /> What {jd.company_name} cares about
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {jd.culture_tags.slice(0, 6).map(tag => (
                <Badge key={tag} className="bg-white/5 text-slate-300 border-white/10 text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          {/* Key skills */}
          <div>
            <h4 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Key skills to highlight
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {jd.required_skills.slice(0, 5).map(skill => (
                <Badge key={skill} className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                  {skill}
                </Badge>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 text-xs text-yellow-300 flex gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              This session will have 12 questions. Take your time with each answer — aim for 90-120 seconds.
              Quality over speed.
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="ghost"
              className="flex-1 text-slate-400 hover:text-white"
              onClick={onClose}
              disabled={starting}
            >
              Change selection
            </Button>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 gap-2"
              onClick={handleStart}
              disabled={starting}
            >
              {starting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Setting up...</>
              ) : (
                <><Play className="w-4 h-4" /> Start Interview</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
