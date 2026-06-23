'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Achievement {
  id: string
  badge_id: string
  earned_at: string
  badges?: {
    name: string
    description: string
    icon: string
  } | null
}

export function BadgeGrid({ achievements }: { achievements: Achievement[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {achievements.map(achievement => (
        <Tooltip key={achievement.id}>
          <TooltipTrigger>
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-2xl cursor-default hover:bg-primary/20 transition-colors">
              {achievement.badges?.icon ?? '🏅'}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="font-semibold">{achievement.badges?.name}</p>
            <p className="text-xs text-slate-400">{achievement.badges?.description}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
