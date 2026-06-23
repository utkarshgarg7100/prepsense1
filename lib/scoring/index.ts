import type { RoundType, SessionScores, Message, AnswerEvaluation } from '@/types'

const FILLER_WORDS = [
  'um', 'uh', 'like', 'basically', 'you know', 'kind of', 'sort of',
  'right', 'so', 'yeah', 'literally', 'honestly', 'obviously', 'actually',
]

export function countFillerWords(text: string): Record<string, number> {
  const lower = text.toLowerCase()
  const counts: Record<string, number> = {}
  for (const word of FILLER_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi')
    const matches = lower.match(regex)
    if (matches && matches.length > 0) {
      counts[word] = matches.length
    }
  }
  return counts
}

export function computeFillerRate(text: string): number {
  const wordCount = text.split(/\s+/).length
  if (wordCount === 0) return 0
  const fillerCounts = countFillerWords(text)
  const totalFillers = Object.values(fillerCounts).reduce((a, b) => a + b, 0)
  return (totalFillers / wordCount) * 100
}

export function computeOwnershipScore(text: string): number {
  const iMatches = (text.match(/\bI\b/g) ?? []).length
  const weMatches = (text.match(/\bwe\b/gi) ?? []).length
  if (iMatches + weMatches === 0) return 50
  const ratio = iMatches / (iMatches + weMatches)
  // Ideal ratio ~0.6-0.8 for individual contributor questions
  if (ratio >= 0.6 && ratio <= 0.8) return 90
  if (ratio >= 0.4 && ratio < 0.6) return 70
  if (ratio >= 0.8) return 75
  return 50
}

export function computeConciseness(wordCount: number, questionType: string): number {
  const isDesign = questionType.includes('design') || questionType.includes('system')
  const min = isDesign ? 200 : 100
  const ideal_min = isDesign ? 300 : 150
  const ideal_max = isDesign ? 500 : 300
  const max = isDesign ? 700 : 500

  if (wordCount < min) return Math.max(30, (wordCount / min) * 60)
  if (wordCount >= ideal_min && wordCount <= ideal_max) return 100
  if (wordCount > ideal_max && wordCount <= max) {
    return Math.max(60, 100 - ((wordCount - ideal_max) / (max - ideal_max)) * 40)
  }
  if (wordCount > max) return 40
  return 75
}

export function computeSTARCompliance(text: string): number {
  const lower = text.toLowerCase()
  const situationMarkers = /\b(when|at|working at|in \d{4}|during|the situation|context was)\b/
  const taskMarkers = /\b(my role|my job|i was responsible|task was|needed to|had to)\b/
  const actionMarkers = /\b(i (did|built|created|designed|implemented|led|proposed|drove|initiated|worked))\b/
  const resultMarkers = /\b(result(ed)?|outcome|achieved|reduced|increased|improved|saved|generated|impact|as a result)\b/

  let score = 0
  if (situationMarkers.test(lower)) score += 20
  if (taskMarkers.test(lower)) score += 20
  if (actionMarkers.test(lower)) score += 40
  if (resultMarkers.test(lower)) score += 20

  return score
}

export function detectHedging(text: string): number {
  const hedgingPatterns = [
    /\bi think\b/gi, /\bmaybe\b/gi, /\bprobably\b/gi,
    /\bi'm not sure\b/gi, /\bkind of\b/gi, /\bsort of\b/gi,
    /\bit depends\b/gi, /\bnot really\b/gi, /\bi guess\b/gi,
  ]
  let count = 0
  for (const pattern of hedgingPatterns) {
    const matches = text.match(pattern)
    if (matches) count += matches.length
  }
  return count
}

export function detectDeflection(text: string): number {
  const deflectionPatterns = [
    /\b(i haven't really|i don't have experience|i'm not familiar|i haven't done)\b/gi,
    /\b(that's a good question|interesting question)\b/gi,
    /\b(i would just|i would basically)\b/gi,
  ]
  let count = 0
  for (const pattern of deflectionPatterns) {
    const matches = text.match(pattern)
    if (matches) count += matches.length
  }
  return count
}

export function aggregateScoresForRound(
  evaluations: AnswerEvaluation[],
  roundType: RoundType,
  answers: string[]
): Partial<SessionScores> {
  if (evaluations.length === 0) {
    return { overall_score: 0 }
  }

  const avgStar = avg(evaluations.map(e => e.star_compliance))
  const avgDepth = avg(evaluations.map(e => e.depth_score))

  const allAnswers = answers.join(' ')
  const wordCounts = answers.map(a => a.split(/\s+/).length)
  const avgWordCount = avg(wordCounts)
  const conciseness = computeConciseness(avgWordCount, 'general')
  const ownership = computeOwnershipScore(allAnswers)
  const fillerRate = computeFillerRate(allAnswers)
  const fillerScore = Math.max(0, 100 - fillerRate * 20)
  const hedgingCount = detectHedging(allAnswers)
  const hedgingScore = Math.max(0, 100 - hedgingCount * 10)

  const consistency = evaluations.some(e => e.consistency_flags.length > 0) ? 60 : 90

  let scores: Partial<SessionScores> = {
    star_compliance: Math.round(avgStar),
    answer_conciseness: Math.round(conciseness),
    consistency: Math.round(consistency),
    verbal_fluency: Math.round(fillerScore),
    communication_clarity: Math.round((fillerScore + hedgingScore) / 2),
    ownership_signals: Math.round(ownership),
  }

  if (roundType === 'technical') {
    scores = {
      ...scores,
      technical_depth: Math.round(avgDepth),
      problem_decomposition: Math.round(avgDepth * 0.9),
      experience_match: Math.round(avgDepth * 0.85),
      gap_awareness: Math.round(avgDepth * 0.8),
      scalability_thinking: Math.round(avgDepth * 0.75),
    }
  } else if (roundType === 'founders') {
    scores = {
      ...scores,
      business_acumen: Math.round(avgDepth),
      first_principles: Math.round(avgDepth * 0.9),
      ambiguity_handling: Math.round(avgDepth * 0.85),
      ownership_signals: Math.round(ownership),
    }
  } else {
    scores = {
      ...scores,
      cultural_alignment: Math.round(avgDepth * 0.9),
      self_awareness: Math.round(avgDepth * 0.85),
      conflict_resolution: Math.round(avgDepth * 0.8),
      motivation_authenticity: Math.round(avgDepth * 0.9),
    }
  }

  const scoreValues = Object.values(scores).filter(v => typeof v === 'number' && v > 0) as number[]
  const overall = Math.round(avg(scoreValues))

  return { ...scores, overall_score: overall }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

export function computeSpeechMetrics(answers: string[], durationSeconds: number[]) {
  const allText = answers.join(' ')
  const fillerWords = countFillerWords(allText)
  const totalFillers = Object.values(fillerWords).reduce((a, b) => a + b, 0)
  const avgDuration = avg(durationSeconds)
  const deflection = detectDeflection(allText)
  const hedging = detectHedging(allText)

  let pace: string
  if (avgDuration < 30) pace = 'Too brief — expand your answers with more context and examples'
  else if (avgDuration < 60) pace = 'Slightly short — aim for 90-120 seconds per answer'
  else if (avgDuration <= 120) pace = 'Excellent pace — well within the ideal range'
  else if (avgDuration <= 180) pace = 'Slightly long — tighten your answers and cut filler'
  else pace = 'Too long — practice being more concise and structured'

  return {
    filler_word_count: totalFillers,
    filler_words: fillerWords,
    avg_answer_length_seconds: Math.round(avgDuration),
    ideal_range_min: 60,
    ideal_range_max: 120,
    deflection_count: deflection,
    hedging_count: hedging,
    pace_assessment: pace,
  }
}
