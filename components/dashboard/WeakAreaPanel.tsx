'use client'

import { Progress } from '@/components/ui/progress'

interface WeakArea {
  tag: string
  avg_score: number
  session_count: number
}

export function WeakAreaPanel({ areas }: { areas: WeakArea[] }) {
  return (
    <div className="space-y-3">
      {areas.map(area => (
        <div key={area.tag}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm capitalize">{area.tag.replace(/-/g, ' ')}</span>
            <span className={`text-xs font-medium tabular-nums ${
              area.avg_score >= 70 ? 'text-emerald-400'
              : area.avg_score >= 50 ? 'text-yellow-400'
              : 'text-rose-400'
            }`}>
              {Math.round(area.avg_score)}/100
            </span>
          </div>
          <Progress
            value={area.avg_score}
            className="h-1.5 bg-white/10"
          />
          <p className="text-xs text-slate-500 mt-0.5">{area.session_count} attempt{area.session_count !== 1 ? 's' : ''}</p>
        </div>
      ))}
    </div>
  )
}
