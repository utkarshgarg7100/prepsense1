/**
 * Picks the next question's (topic, difficulty) — Model 1's deployment side.
 *
 * **A three-layer fallback, and the layering is the point.** The trained policy runs in
 * a separate Python process (`ml/serve.py`), so it can be down, slow, or not started at
 * all — during a demo, on a fresh clone, or because someone forgot. An interview must
 * never fail for that reason, so:
 *
 *   1. `policy`   — the trained PPO controller
 *   2. `thompson` — Thompson sampling over the stored scorecard, in-process, no network
 *   3. `llm`      — give up choosing and let the interviewer prompt decide, as before
 *
 * Layer 2 is not a token gesture: it reads the same persistent scorecard, so an outage
 * costs the *learned* policy, not the adaptive behaviour. That is what makes running a
 * second process an acceptable risk.
 *
 * **A number not to quote loosely.** `ml/baselines.py` measures a Thompson policy at
 * 0.0713 against the trained policy's 0.0750, but that is not this code: the simulator's
 * version builds its arms within an episode from whether the previous pull moved the
 * estimate, while this one derives them from stored BKT mastery across sessions. They
 * are the same algorithm on different evidence. The simulator figure is the right order
 * of magnitude for what a fallback costs, and the wrong thing to cite as this
 * implementation's score.
 *
 * **On the honest framing for the write-up:** Phase 4 concluded that the policy only
 * *ties* the weakest-first heuristic. It is deployed as the primary layer anyway because
 * it performs equivalently and is the artefact the project set out to build; nothing here
 * claims it beats the fallback. See `RESEARCH_LOG.md` F9.
 *
 * Caching was checked rather than assumed: Next does not cache POST `fetch` calls or
 * non-GET route handlers, so no `cache: 'no-store'` is needed to keep each call live.
 */

import { DEFAULT_TOPICS } from '@/lib/kt/bkt'
import { getPriorityTagsForSession, type BanditArm } from '@/lib/rl/bandit'

export type ChooserSource = 'policy' | 'thompson' | 'llm'
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface ChoiceState {
  mastery: Record<string, number>
  attempts: Record<string, number>
  /** Chronological, oldest first — the service's streak feature reads from the end. */
  recentScores: number[]
  step: number
  questions: number
}

export interface Choice {
  topic: string
  difficulty: Difficulty
  source: ChooserSource
  /** Populated on the `policy` path so a stored experience row records which policy chose. */
  policyName?: string
  /**
   * The raw discrete action index, 0–44. Only the policy path has one — the fallbacks
   * choose a topic directly and never form an action — so it is optional, and a null in
   * `rl_experience.action` is the honest record of "no policy action was taken".
   */
  action?: number
}

// Read per call, not at module load. The degradation test flips these between cases,
// and a module-scope constant would freeze whatever was set when the module was first
// imported — making the test pass for the wrong reason.
const policyUrl = () => process.env.POLICY_URL ?? 'http://localhost:8000'

/**
 * Short on purpose. This call sits between the candidate submitting an answer and the
 * next question appearing, behind an LLM call that already costs ~1s. A policy that
 * needs longer than this has effectively failed, and the local fallback is instant —
 * so waiting is strictly worse than falling back.
 */
const timeoutMs = () => Number(process.env.POLICY_TIMEOUT_MS ?? 1500)

/** Mirrors `DIFFICULTY_LEVEL` in `ml/student_sim.py`. */
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as string[]).includes(value)
}

/**
 * Difficulty for the fallback layers, matching the simulator's ZPD assumption: a
 * question far below or far above the candidate teaches nothing, so aim near their
 * current estimated ability.
 *
 * The thresholds are the midpoints between the levels the simulator uses
 * (easy 0.25, medium 0.55, hard 0.80), so the fallback and the trained policy are
 * choosing on the same scale rather than on two unrelated notions of "hard".
 */
export function difficultyForMastery(mastery: number): Difficulty {
  if (mastery < 0.4) return 'easy'
  if (mastery < 0.675) return 'medium'
  return 'hard'
}

/** Layer 1: the trained policy. Returns null on any failure — never throws. */
async function askPolicy(state: ChoiceState): Promise<Choice | null> {
  try {
    const response = await fetch(`${policyUrl()}/infer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mastery: state.mastery,
        attempts: state.attempts,
        recent_scores: state.recentScores,
        step: state.step,
        questions: state.questions,
      }),
      // Covers a hung connection, which a plain timeout on the promise would not:
      // without this the request stays open and the route holds the response.
      signal: AbortSignal.timeout(timeoutMs()),
    })

    if (!response.ok) {
      console.warn(`Policy service returned ${response.status}; falling back.`)
      return null
    }

    const body = await response.json()

    // Validated rather than trusted. The topic indexes the scorecard and the action
    // space; an unrecognised string would flow onward and quietly tag an answer
    // against a topic that does not exist, so the fallback is the safer branch.
    if (!DEFAULT_TOPICS.includes(body?.topic) || !isDifficulty(body?.difficulty)) {
      console.warn('Policy service returned an unrecognised choice; falling back.', body)
      return null
    }

    return {
      topic: body.topic,
      difficulty: body.difficulty,
      source: 'policy',
      policyName: typeof body.policy === 'string' ? body.policy : undefined,
      action: typeof body.action === 'number' ? body.action : undefined,
    }
  } catch (error) {
    // Includes the timeout, a refused connection (service not started) and DNS
    // failures. All are "the policy is unavailable", which is not an error condition
    // for the interview — hence warn, not throw.
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`Policy service unavailable (${reason}); falling back to Thompson.`)
    return null
  }
}

/**
 * Layer 2: Thompson sampling over the scorecard, in-process.
 *
 * The bandit's arms were designed to be updated from raw scores over a session. Here
 * they are derived from stored BKT mastery instead, so the fallback inherits the same
 * cross-session memory the policy uses rather than restarting from a flat prior on
 * every request.
 *
 * **`BELIEF_CONCENTRATION` is why this works, and the first version without it did
 * not.** Weighting mastery by `attempts` alone — Beta(1 + m·n, 1 + (1−m)·n) — makes a
 * topic asked once almost indistinguishable from one never asked, so the sampled
 * distributions of all fifteen topics overlap and the weakest is picked only ~19% of
 * the time against a 6.7% floor. That is correct for a bandit estimating from raw
 * outcomes, but wrong here: BKT mastery is *already* a posterior that has integrated
 * every past answer, including from previous sessions. Treating it as one observation
 * discards the tracing model's entire output. The base concentration says the stored
 * belief is worth several observations on its own; `attempts` still sharpens it, so an
 * often-asked topic is sampled with more confidence than a freshly seeded prior.
 */
const BELIEF_CONCENTRATION = 6
const ATTEMPT_WEIGHT = 2

export function chooseWithThompson(state: ChoiceState): Choice {
  const arms: BanditArm[] = DEFAULT_TOPICS.map(topic => {
    const mastery = state.mastery[topic] ?? 0.25
    const attempts = state.attempts[topic] ?? 0
    const concentration = BELIEF_CONCENTRATION + ATTEMPT_WEIGHT * attempts
    // +1 on each keeps both parameters positive whatever the mastery, so a topic at
    // 0.0 or 1.0 still samples rather than collapsing to a point.
    return {
      tag: topic,
      alpha: 1 + mastery * concentration,
      beta: 1 + (1 - mastery) * concentration,
      avg_score: mastery * 100,
      session_count: attempts,
    }
  })

  // Lowest sample first: the bandit prioritises the arm believed weakest.
  const [topic] = getPriorityTagsForSession(arms, 1)
  const chosen = topic ?? DEFAULT_TOPICS[0]
  return {
    topic: chosen,
    difficulty: difficultyForMastery(state.mastery[chosen] ?? 0.25),
    source: 'thompson',
  }
}

/**
 * Choose the next question's topic and difficulty.
 *
 * Never throws and never returns null: the caller always gets a usable choice, and
 * reads `source` to know which layer produced it. A caller that wants the LLM to decide
 * on its own can check for `source === 'llm'`, which this returns only when
 * `POLICY_ENABLED=false` disables the chooser entirely.
 */
export async function chooseNextQuestion(state: ChoiceState): Promise<Choice> {
  if (process.env.POLICY_ENABLED === 'false') {
    return { topic: '', difficulty: 'medium', source: 'llm' }
  }
  return (await askPolicy(state)) ?? chooseWithThompson(state)
}
