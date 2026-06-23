// Thompson Sampling Multi-Armed Bandit for question selection

export interface BanditArm {
  tag: string
  alpha: number  // successes (good scores) + 1
  beta: number   // failures (bad scores) + 1
  avg_score: number
  session_count: number
}

// Sample from Beta distribution using Johnk's method
function sampleBeta(alpha: number, beta: number): number {
  // Using the relationship between Beta and Gamma distributions
  // approximated via normal distribution for large params
  if (alpha > 1 && beta > 1) {
    const mean = alpha / (alpha + beta)
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1))
    const std = Math.sqrt(variance)
    // Box-Muller transform for normal sample
    const u1 = Math.random()
    const u2 = Math.random()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return Math.max(0, Math.min(1, mean + std * z))
  }
  // For small params, use inverse CDF approximation
  const x = Math.random()
  return Math.pow(x, 1 / alpha) / (Math.pow(x, 1 / alpha) + Math.pow(1 - x, 1 / beta))
}

export function sampleArmPriority(arms: BanditArm[]): BanditArm[] {
  return arms
    .map(arm => ({
      arm,
      sample: sampleBeta(arm.alpha, arm.beta),
    }))
    .sort((a, b) => a.sample - b.sample) // Lower sample = worse performance = higher priority
    .map(({ arm }) => arm)
}

export function updateArmFromScore(arm: BanditArm, score: number): BanditArm {
  // Normalize score to [0, 1]
  const normalizedScore = score / 100

  // Update Beta distribution
  // High score = success, Low score = failure
  const newAlpha = arm.alpha + normalizedScore
  const newBeta = arm.beta + (1 - normalizedScore)

  // Update running average
  const newCount = arm.session_count + 1
  const newAvgScore = (arm.avg_score * arm.session_count + score) / newCount

  return {
    ...arm,
    alpha: newAlpha,
    beta: newBeta,
    avg_score: newAvgScore,
    session_count: newCount,
  }
}

export function updateArmFromFeedback(arm: BanditArm, isRelevant: boolean): BanditArm {
  // User thumbs up/down as secondary signal (smaller weight)
  const delta = isRelevant ? 0.2 : -0.2
  return {
    ...arm,
    alpha: Math.max(1, arm.alpha + (isRelevant ? 0.2 : 0)),
    beta: Math.max(1, arm.beta + (isRelevant ? 0 : 0.2)),
  }
}

export function getWeakestTags(arms: BanditArm[], topN: number = 5): string[] {
  return arms
    .filter(arm => arm.session_count > 0)
    .sort((a, b) => a.avg_score - b.avg_score)
    .slice(0, topN)
    .map(arm => arm.tag)
}

export function getPriorityTagsForSession(arms: BanditArm[], targetCount: number = 3): string[] {
  const sampled = sampleArmPriority(arms)
  return sampled.slice(0, targetCount).map(arm => arm.tag)
}

// Default arms for a new user (all question categories)
export const DEFAULT_TAGS = [
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
]

export function initializeArmsForUser(): BanditArm[] {
  return DEFAULT_TAGS.map(tag => ({
    tag,
    alpha: 1,
    beta: 1,
    avg_score: 50,
    session_count: 0,
  }))
}
