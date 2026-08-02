'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { JobDescription } from '@/types'
import { Building2, Play, Trash2 } from 'lucide-react'

interface Props {
  jd: JobDescription
  onSelect: () => void
  isSelected: boolean
  /** Present only for the user's own JDs; seeded ones cannot be deleted. */
  onDelete?: () => void
}

const TIER_COLORS: Record<string, string> = {
  'FAANG': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Indian Unicorn': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Global MNC': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Series B Startup': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'Other': 'bg-slate-500/20 text-slate-300 border-slate-500/30',
}

const COMPANY_INITIALS: Record<string, string> = {
  Google: 'G', Meta: 'M', Amazon: 'A', Microsoft: 'MS', Apple: 'AP',
  Flipkart: 'FK', Razorpay: 'RP', PhonePe: 'PP', Swiggy: 'SW',
  Zomato: 'ZO', CRED: 'CR', Groww: 'GW', Meesho: 'ME', Atlassian: 'AT',
  Salesforce: 'SF', Paytm: 'PT', Ola: 'OL', Navi: 'NA', Juspay: 'JP',
  Zepto: 'ZP',
}

export function JDCard({ jd, onSelect, isSelected, onDelete }: Props) {
  const isCustom = !!jd.user_id
  return (
    <Card
      className={`border-white/10 bg-card hover:border-primary/30 transition-all cursor-pointer ${
        isSelected ? 'border-primary ring-1 ring-primary/30' : ''
      }`}
      onClick={onSelect}
    >
      <CardContent className="pt-5 pb-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
            {COMPANY_INITIALS[jd.company_name] ?? <Building2 className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-tight">{jd.role_subtype}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{jd.company_name} · {jd.industry}</p>
          </div>
        </div>

        {/* Tier */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-xs ${TIER_COLORS[jd.company_tier] ?? ''}`}>
            {jd.company_tier}
          </Badge>
          {isCustom && (
            <Badge className="text-xs bg-primary/20 text-primary border-primary/30">
              Yours
            </Badge>
          )}
          {isCustom && onDelete && (
            <button
              aria-label="Delete this job description"
              className="ml-auto text-slate-500 hover:text-red-400 transition-colors"
              onClick={e => { e.stopPropagation(); onDelete() }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Skills */}
        <div className="flex flex-wrap gap-1">
          {jd.required_skills.slice(0, 4).map(skill => (
            <span
              key={skill}
              className="text-xs px-2 py-0.5 rounded-md bg-white/5 text-slate-400 border border-white/10"
            >
              {skill}
            </span>
          ))}
          {jd.required_skills.length > 4 && (
            <span className="text-xs px-2 py-0.5 rounded-md bg-white/5 text-slate-500">
              +{jd.required_skills.length - 4} more
            </span>
          )}
        </div>

        {/* CTA */}
        <Button
          size="sm"
          className="w-full bg-primary/20 hover:bg-primary text-primary hover:text-white border border-primary/30 transition-colors gap-2 mt-1"
          onClick={e => { e.stopPropagation(); onSelect() }}
        >
          <Play className="w-3 h-3" /> Start Interview
        </Button>
      </CardContent>
    </Card>
  )
}
