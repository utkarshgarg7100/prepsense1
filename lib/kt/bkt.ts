/**
 * Bayesian Knowledge Tracing (Model 2) — TypeScript port of `ml/bkt.py`.
 *
 * Tracks a single probability per topic: how likely it is that this candidate has
 * really mastered it. After each answer the probability is updated twice — once on
 * the evidence (allowing for slips and lucky guesses), then once for the chance
 * that attempting the question taught them something.
 *
 * `ml/bkt.py` is the reference implementation and the one the RL simulator uses
 * offline; this port keeps real users' state current online. Unlike the parser, the
 * two sides here are pure arithmetic with no linguistic step, so they must agree to
 * floating-point precision — `ml/test_bkt_parity.py` asserts exactly that.
 */

export const DEFAULT_TOPICS = [
  'system-design',
  'leadership',
  'conflict',
  'technical-depth',
  'behavioral',
  'product-sense',
  'metrics',
  'communication',
  'ownership',
  'problem-solving',
  'cultural-fit',
  'resume-probe',
  'gap-probe',
  'ambiguity',
  'first-principles',
] as const

export type Topic = (typeof DEFAULT_TOPICS)[number]

export interface BKTParams {
  /** P(already knows the topic at session zero). */
  p_init: number
  /** P(learns it by attempting a question). */
  p_learn: number
  /** P(answers badly | knows it). */
  p_slip: number
  /** P(answers well | does not know it). */
  p_guess: number
}

/**
 * Hand-set for the interview domain, not fitted to a math-tutoring dataset.
 *
 * The deviation that matters is `p_guess`: on multiple-choice questions it sits near
 * 0.25 because a learner can pick at random, but an open-ended interview answer
 * cannot be guessed into a good rubric score. Kept identical to `ml/bkt.py`;
 * changing one side without the other silently desynchronises the simulator from
 * production.
 */
export const DEFAULT_PARAMS: BKTParams = {
  p_init: 0.25,
  p_learn: 0.12,
  p_slip: 0.10,
  p_guess: 0.08,
}

/** The rubric score at which an answer counts as evidence of mastery. */
export const MASTERY_THRESHOLD = 60

export function validateParams(params: BKTParams): void {
  for (const name of ['p_init', 'p_learn', 'p_slip', 'p_guess'] as const) {
    const value = params[name]
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`bkt: ${name} must be in [0, 1], got ${value}`)
    }
  }
  // Slip + guess >= 1 inverts the model: a correct answer would become evidence
  // *against* mastery. The standard BKT identifiability constraint.
  if (params.p_slip + params.p_guess >= 1) {
    throw new Error(
      `bkt: p_slip + p_guess must be < 1 (got ${(params.p_slip + params.p_guess).toFixed(3)}); ` +
      'otherwise correct answers reduce inferred mastery'
    )
  }
}

/**
 * P(observed correct) given current mastery — marginalising over the two routes to
 * a correct answer: knows it and does not slip, or does not know it and guesses.
 */
export function probCorrect(mastery: number, params: BKTParams = DEFAULT_PARAMS): number {
  return mastery * (1 - params.p_slip) + (1 - mastery) * params.p_guess
}

/** Bayes update of mastery on an observed outcome, before the learning transition. */
export function posterior(
  mastery: number,
  correct: boolean,
  params: BKTParams = DEFAULT_PARAMS
): number {
  let numerator: number
  let denominator: number
  if (correct) {
    numerator = mastery * (1 - params.p_slip)
    denominator = numerator + (1 - mastery) * params.p_guess
  } else {
    numerator = mastery * params.p_slip
    denominator = numerator + (1 - mastery) * (1 - params.p_guess)
  }

  // Degenerate case: the observation has zero likelihood under both hypotheses.
  // Leaving mastery unchanged is the safe response.
  if (denominator === 0) return mastery
  return numerator / denominator
}

/**
 * One full BKT step: evidence update, then the learning transition.
 *
 * The single function the simulator and this port both implement — the parity test
 * targets it directly.
 */
export function update(
  mastery: number,
  correct: boolean,
  params: BKTParams = DEFAULT_PARAMS
): number {
  const p = posterior(mastery, correct, params)
  return p + (1 - p) * params.p_learn
}

/**
 * Collapse a 0–100 rubric score into the binary signal BKT consumes.
 *
 * This threshold is the seam between Model 3 (LLM evaluation) and Model 2, and it is
 * a real modelling decision: too high and every candidate looks permanently
 * incompetent, too low and mastery saturates after a few questions, leaving the
 * curriculum controller no signal to act on. 60 matches the pass mark in
 * `lib/scoring`.
 */
export function scoreToObservation(score: number, threshold = MASTERY_THRESHOLD): boolean {
  return score >= threshold
}

/**
 * Score difference worth roughly one logistic unit of confidence. Mirrors
 * `SOFTNESS` in `ml/bkt.py`; swept in the Phase 4 sensitivity analysis.
 */
export const SOFTNESS = 15

/**
 * How strongly a 0–100 rubric score argues that the candidate knows the topic.
 *
 * `scoreToObservation` discards nearly everything the rubric measured: a 61 and a 99
 * become the same observation, as do a 59 and a 12. That is what makes mastery
 * saturate after two questions — every passing answer counts as maximally strong
 * evidence — leaving the curriculum controller fifteen near-identical numbers and
 * nothing to act on.
 *
 * A logistic centred on the pass mark keeps the same meaning at the threshold
 * (60 → 0.5) while letting the *margin* matter.
 */
export function observationConfidence(
  score: number,
  threshold = MASTERY_THRESHOLD,
  softness = SOFTNESS
): number {
  return 1 / (1 + Math.exp(-(score - threshold) / softness))
}

/**
 * BKT step under an *uncertain* observation: the expected posterior, running the
 * update both ways and weighting by how likely each outcome is.
 *
 * At confidence 1 or 0 this reduces exactly to `update(…, true/false)`, so the old
 * hard-threshold behaviour is a special case rather than a separate code path —
 * which is what keeps the two comparable in the Phase 4 sweep.
 */
export function updateSoft(
  mastery: number,
  confidence: number,
  params: BKTParams = DEFAULT_PARAMS
): number {
  if (!(confidence >= 0 && confidence <= 1)) {
    throw new Error(`bkt: confidence must be in [0, 1], got ${confidence}`)
  }
  return (
    confidence * update(mastery, true, params) +
    (1 - confidence) * update(mastery, false, params)
  )
}

export interface MasteryUpdate {
  topic: string
  before: number
  after: number
  gain: number
  /** Graded strength of the evidence, in (0, 1). 0.5 means the answer was borderline. */
  confidence: number
}

/**
 * Apply one answer's outcome across every topic that question exercised.
 *
 * A question is tagged with several topics, and the same outcome updates all of
 * them. That is a deliberate simplification of BKT, which assumes one skill per
 * item: an answer scoring 80 on a question tagged `leadership` and `conflict` is
 * treated as evidence for both. Attributing credit between co-tagged topics would
 * need a multi-skill model (and data to fit it) that this project does not have.
 *
 * Unknown tags are skipped rather than throwing — question tags come from an LLM
 * and cannot be trusted to stay inside the taxonomy.
 *
 * Uses the graded update: how far above or below the pass mark the answer scored
 * determines how much mastery moves. `softness = 0` selects the old hard threshold,
 * which the Phase 4 baselines use for comparison.
 */
export function applyAnswer(
  mastery: Record<string, number>,
  topics: string[],
  score: number,
  params: BKTParams = DEFAULT_PARAMS,
  threshold = MASTERY_THRESHOLD,
  softness = SOFTNESS
): MasteryUpdate[] {
  const confidence =
    softness > 0
      ? observationConfidence(score, threshold, softness)
      : scoreToObservation(score, threshold) ? 1 : 0
  const known = new Set<string>(DEFAULT_TOPICS)
  const updates: MasteryUpdate[] = []

  for (const topic of new Set(topics)) {
    if (!known.has(topic)) continue
    const before = mastery[topic] ?? params.p_init
    const after = updateSoft(before, confidence, params)
    updates.push({ topic, before, after, gain: after - before, confidence })
  }
  return updates
}

/** Mastery in the fixed topic order — the RL policy's observation vector. */
export function masteryVector(
  mastery: Record<string, number>,
  params: BKTParams = DEFAULT_PARAMS
): number[] {
  return DEFAULT_TOPICS.map(t => mastery[t] ?? params.p_init)
}

export function weakestTopics(mastery: Record<string, number>, n = 5): string[] {
  return [...DEFAULT_TOPICS]
    .sort((a, b) => (mastery[a] ?? DEFAULT_PARAMS.p_init) - (mastery[b] ?? DEFAULT_PARAMS.p_init))
    .slice(0, n)
}
