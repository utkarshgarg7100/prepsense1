'use client'

interface Props {
  label: string
  score: number
}

export function ScorePill({ label, score }: Props) {
  const color =
    score >= 75 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
    : score >= 50 ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20'
    : 'bg-rose-500/15 text-rose-400 border-rose-500/20'

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${color}`}>
      {label} {score}
    </span>
  )
}
