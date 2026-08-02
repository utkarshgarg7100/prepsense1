/**
 * The scores must equal their own justification.
 *
 * `reconcileEvaluation` is what makes the rubric defensible: the headline numbers are
 * computed from the worksheet rather than stated separately by the model, so a score
 * and its explanation cannot contradict each other. These tests pin that property,
 * plus the degradation paths — a provider that ignores the new prompt must still
 * produce a working evaluation.
 *
 * Run: `npx tsx scripts/test-reconcile.ts`
 */

import { reconcileEvaluation } from '../lib/ai/reconcile'

const results: Array<{ label: string; ok: boolean; detail: string }> = []
function check(label: string, ok: boolean, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const row = (name: string, points: number, max: number, evidence: string | null = 'quoted text') => ({
  name,
  points,
  max_points: max,
  verdict: 'partial',
  evidence,
  reason: 'because',
  fix: 'do this',
})

// --- The central property ---------------------------------------------------
const full = reconcileEvaluation({
  score_breakdown: {
    star: [row('Situation', 20, 20), row('Task', 10, 20), row('Action', 20, 40), row('Result', 0, 20, null)],
    depth: [row('Specificity', 20, 25), row('Metrics', 5, 25), row('Accuracy', 25, 25), row('Trade-offs', 10, 25)],
  },
  answer_summary: 'They described a migration.',
})

// 50/100 and 60/100 by addition — not by assertion.
check('star score is the sum of its parts', full.star_compliance === 50, `${full.star_compliance}`)
check('depth score is the sum of its parts', full.depth_score === 60, `${full.depth_score}`)
check('breakdown is preserved', full.score_breakdown?.star.length === 4)

// --- A model that contradicts itself is overruled ---------------------------
// The whole point: the stated score is discarded when a worksheet exists.
const contradictory = reconcileEvaluation({
  star_compliance: 95,
  depth_score: 5,
  score_breakdown: {
    star: [row('Situation', 0, 20, null), row('Task', 0, 20, null), row('Action', 0, 40, null), row('Result', 0, 20, null)],
    depth: [row('Specificity', 25, 25), row('Metrics', 25, 25), row('Accuracy', 25, 25), row('Trade-offs', 25, 25)],
  },
})
check('a stated score cannot override the worksheet', contradictory.star_compliance === 0 && contradictory.depth_score === 100,
  `star=${contradictory.star_compliance} depth=${contradictory.depth_score}`)

// --- Unsupported awards are downgraded, not displayed as strong -------------
const unsupported = reconcileEvaluation({
  score_breakdown: {
    star: [{ ...row('Action', 40, 40, null), verdict: 'strong' }],
    depth: [],
  },
})
check('a "strong" verdict with no quote is downgraded',
  unsupported.score_breakdown?.star[0].verdict === 'partial',
  unsupported.score_breakdown?.star[0].verdict)

// --- Out-of-range values are clamped, not trusted ---------------------------
const wild = reconcileEvaluation({
  score_breakdown: { star: [row('Action', 999, 40)], depth: [row('Specificity', -50, 25)] },
})
check('points are clamped into range',
  wild.star_compliance === 100 && wild.depth_score === 0,
  `star=${wild.star_compliance} depth=${wild.depth_score}`)

// --- A short worksheet is normalised, not silently depressed ---------------
// Three rows out of four must not read as a 25% penalty the candidate did not earn.
const short = reconcileEvaluation({
  score_breakdown: { star: [row('Situation', 20, 20), row('Task', 20, 20)], depth: [] },
})
check('a partial worksheet normalises to its own maximum', short.star_compliance === 100, `${short.star_compliance}`)

// --- Degradation: a provider that ignores the new prompt -------------------
const legacy = reconcileEvaluation({
  star_compliance: 72,
  depth_score: 64,
  answer_summary: 'Legacy shape.',
  claims_made: ['shipped a thing'],
})
check('falls back to stated scores when no worksheet exists',
  legacy.star_compliance === 72 && legacy.depth_score === 64)
check('no breakdown is reported rather than an empty one', legacy.score_breakdown === undefined)
check('other fields survive', legacy.claims_made[0] === 'shipped a thing')

// --- Garbage must not throw; the interview outranks the feature ------------
const garbage = reconcileEvaluation({ score_breakdown: { star: [null, 'nonsense', {}], depth: 'not an array' } })
check('malformed rows are dropped, not rendered', garbage.score_breakdown === undefined)
check('garbage yields a usable evaluation', garbage.star_compliance === 0 && garbage.depth_score === 0)
check('empty input does not throw', reconcileEvaluation({}).answer_summary === '')

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
