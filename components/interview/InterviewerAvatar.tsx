'use client'

import type { RoundType } from '@/types'

interface Props {
  roundType: RoundType
  isSpeaking?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const AVATARS: Record<RoundType, { emoji: string; bg: string; ring: string }> = {
  technical: { emoji: '👨‍💻', bg: 'bg-blue-500/20', ring: 'ring-blue-500/40' },
  founders:  { emoji: '👩‍💼', bg: 'bg-purple-500/20', ring: 'ring-purple-500/40' },
  hr:        { emoji: '🤝', bg: 'bg-emerald-500/20', ring: 'ring-emerald-500/40' },
}

const SIZES = {
  sm: 'w-8 h-8 text-base',
  md: 'w-10 h-10 text-xl',
  lg: 'w-14 h-14 text-3xl',
}

export function InterviewerAvatar({ roundType, isSpeaking, size = 'md' }: Props) {
  const { emoji, bg, ring } = AVATARS[roundType]
  return (
    <div
      className={`${SIZES[size]} ${bg} rounded-full flex items-center justify-center transition-all ${
        isSpeaking ? `ring-2 ${ring} pulse-ring` : ''
      }`}
    >
      {emoji}
    </div>
  )
}
