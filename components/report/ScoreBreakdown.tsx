'use client'

/**
 * The scoring worksheet: what each component earned, quoted from the answer, and what
 * would have earned the rest.
 *
 * This is the answer to "why was my score so low?" — a question the product previously
 * could not answer at all, since the model returned two bare numbers. Every row shows
 * the candidate's own words as the basis for the award, so the score is traceable
 * rather than asserted.
 *
 * Renders nothing when there is no breakdown: answers scored before this existed have
 * none, and an empty scaffold would imply the reasoning was withheld rather than never
 * recorded.
 */

import type { ScoreBreakdown as Breakdown, ScoreCriterion } from '@/types'

const VERDICT_STYLE: Record<ScoreCriterion['verdict'], string> = {
  strong: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  partial: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
  missing: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
}

function CriterionRow({ criterion }: { criterion: ScoreCriterion }) {
  const ratio = criterion.max_points > 0 ? criterion.points / criterion.max_points : 0

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-slate-200 truncate">{criterion.name}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium capitalize ${VERDICT_STYLE[criterion.verdict]}`}
          >
            {criterion.verdict}
          </span>
        </div>
        <span className="text-xs font-mono text-slate-300 shrink-0">
          {criterion.points}<span className="text-slate-600">/{criterion.max_points}</span>
        </span>
      </div>

      <div className="h-1 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            ratio >= 0.75 ? 'bg-emerald-500' : ratio > 0 ? 'bg-yellow-500' : 'bg-rose-500/40'
          }`}
          style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 4 : 0)}%` }}
        />
      </div>

      {criterion.reason && <p className="text-xs text-slate-400">{criterion.reason}</p>}

      {/* The quote is the evidence for the award. Its absence is meaningful in itself:
          nothing in the answer supported this component. */}
      {criterion.evidence ? (
        <blockquote className="border-l-2 border-primary/40 pl-2 text-xs italic text-slate-300">
          &ldquo;{criterion.evidence}&rdquo;
        </blockquote>
      ) : (
        <p className="text-xs text-slate-500 italic">Nothing in your answer covered this.</p>
      )}

      {criterion.fix && ratio < 1 && (
        <p className="text-xs text-primary/90">
          <span className="font-semibold">To earn the rest: </span>
          {criterion.fix}
        </p>
      )}
    </div>
  )
}

function Group({ title, score, criteria }: { title: string; score: number; criteria: ScoreCriterion[] }) {
  if (criteria.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
        <span className="text-xs text-slate-500">
          totals <b className="text-slate-300">{score}</b>/100
        </span>
      </div>
      <div className="space-y-2">
        {criteria.map((criterion, i) => (
          <CriterionRow key={`${criterion.name}-${i}`} criterion={criterion} />
        ))}
      </div>
    </div>
  )
}

interface Props {
  breakdown: Breakdown | undefined
  starScore: number
  depthScore: number
}

export function ScoreBreakdownPanel({ breakdown, starScore, depthScore }: Props) {
  if (!breakdown) return null
  const { star, depth } = breakdown
  if (star.length === 0 && depth.length === 0) return null

  return (
    <div className="space-y-4">
      <Group title="Structure (STAR)" score={starScore} criteria={star} />
      <Group title="Depth & substance" score={depthScore} criteria={depth} />
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Each score is the sum of the points above it — the breakdown is the score, not a
        commentary on it.
      </p>
    </div>
  )
}
