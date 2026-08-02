/**
 * Deriving the headline scores from the itemised worksheet.
 *
 * **Why this exists.** Asking a model for a score *and* a justification produces two
 * independent outputs, and they drift: a 40 explained by reasoning that adds to 75 is a
 * routine result. The candidate is then told a number and given an explanation that
 * contradicts it, and cannot tell which to trust. For a coaching tool that is worse
 * than no explanation at all.
 *
 * So the prompt no longer asks for `star_compliance` or `depth_score` at all. It asks
 * for the worksheet, and the scores are computed here by addition. The explanation is
 * not a commentary on the score — it *is* the score. They cannot disagree, because
 * there is only one of them.
 *
 * This also makes the rubric auditable, which the project's write-up needs: a score can
 * be traced to named components, each carrying a quote from the candidate's own answer.
 */

import type { AnswerEvaluation, ScoreBreakdown, ScoreCriterion } from '@/types'

const VERDICTS = new Set(['strong', 'partial', 'missing'])

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

/**
 * Coerce one worksheet row into something trustworthy.
 *
 * Returns null for a row too malformed to interpret, rather than inventing values — a
 * fabricated criterion would be indistinguishable from a real one in the UI.
 */
function normaliseCriterion(raw: unknown): ScoreCriterion | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.name !== 'string' || !row.name.trim()) return null

  const max = Number(row.max_points)
  if (!Number.isFinite(max) || max <= 0) return null
  const points = clamp(Number(row.points) || 0, 0, max)

  // An evidence-free award is the failure mode this rubric exists to prevent, so it is
  // corrected rather than displayed: without a quote the points are unsupported, and
  // the verdict is downgraded to match what can actually be shown.
  const evidence =
    typeof row.evidence === 'string' && row.evidence.trim() ? row.evidence.trim() : null

  const stated = typeof row.verdict === 'string' ? row.verdict : ''
  const ratio = points / max
  const verdict = VERDICTS.has(stated)
    ? (stated as ScoreCriterion['verdict'])
    : ratio >= 0.75 ? 'strong' : ratio > 0 ? 'partial' : 'missing'

  return {
    name: row.name.trim(),
    points,
    max_points: max,
    verdict: evidence === null && verdict === 'strong' ? 'partial' : verdict,
    evidence,
    reason: typeof row.reason === 'string' ? row.reason.trim() : '',
    fix: typeof row.fix === 'string' ? row.fix.trim() : '',
  }
}

function normaliseGroup(raw: unknown): ScoreCriterion[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normaliseCriterion).filter((c): c is ScoreCriterion => c !== null)
}

/**
 * Sum a group to a 0–100 score.
 *
 * Normalised by the group's own maximum rather than assumed to be 100, so a model that
 * returns three criteria instead of four still yields a comparable score instead of one
 * silently depressed by the missing row.
 */
function scoreOf(criteria: ScoreCriterion[]): number | null {
  if (criteria.length === 0) return null
  const earned = criteria.reduce((sum, c) => sum + c.points, 0)
  const available = criteria.reduce((sum, c) => sum + c.max_points, 0)
  if (available <= 0) return null
  return Math.round((earned / available) * 100)
}

/**
 * Turn a raw model response into a consistent `AnswerEvaluation`.
 *
 * Falls back to any scores the model volunteered when a worksheet is missing or
 * unusable, so a provider that ignores the new prompt still returns a working
 * evaluation — the interview must not depend on this feature.
 */
export function reconcileEvaluation(parsed: Record<string, unknown>): AnswerEvaluation {
  const rawBreakdown = (parsed.score_breakdown ?? {}) as Record<string, unknown>
  const star = normaliseGroup(rawBreakdown.star)
  const depth = normaliseGroup(rawBreakdown.depth)

  const starScore = scoreOf(star)
  const depthScore = scoreOf(depth)

  const breakdown: ScoreBreakdown | undefined =
    star.length || depth.length ? { star, depth } : undefined

  return {
    star_compliance: starScore ?? clamp(Number(parsed.star_compliance) || 0, 0, 100),
    depth_score: depthScore ?? clamp(Number(parsed.depth_score) || 0, 0, 100),
    claims_made: Array.isArray(parsed.claims_made) ? (parsed.claims_made as string[]) : [],
    follow_up_worthy: Boolean(parsed.follow_up_worthy),
    suggested_follow_up:
      typeof parsed.suggested_follow_up === 'string' ? parsed.suggested_follow_up : null,
    consistency_flags: Array.isArray(parsed.consistency_flags)
      ? (parsed.consistency_flags as string[])
      : [],
    answer_summary: typeof parsed.answer_summary === 'string' ? parsed.answer_summary : '',
    strong_answer_example:
      typeof parsed.strong_answer_example === 'string' ? parsed.strong_answer_example : '',
    score_breakdown: breakdown,
  }
}
