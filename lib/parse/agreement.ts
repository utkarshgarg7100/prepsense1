/**
 * Agreement between the classical parser (Model 5) and the LLM parser it replaced.
 *
 * The two do not produce comparable outputs directly: the classical parser scores 15
 * fixed topics, while the LLM returns free-text skill strings ("Kubernetes", "React
 * Native"). Comparing those lists term-by-term would measure vocabulary, not
 * agreement, and would always look bad.
 *
 * So both are projected onto the same axis — the topic taxonomy — and compared
 * there. That is the only claim the app actually relies on: *which areas is this
 * candidate strong in*. This is the Phase 1 baseline comparison; the numbers it
 * produces go in the report.
 */

import { TOPIC_KEYWORDS, TOPICS } from './lexicon'
import { normalise, type ParseResult } from './parser'

export interface ParserAgreement {
  /** Topics the classical parser ranks as best-evidenced, strongest first. */
  classical_top: string[]
  /** The same ranking derived from the LLM's free-text skill list. */
  llm_top: string[]
  /**
   * Shared topics as a fraction of the *shorter* list. Answers "was everything the
   * LLM identified also found by the classical parser?" — the fair question, since
   * the LLM typically names only two or three mappable topics.
   */
  overlap: number
  /**
   * Shared topics as a fraction of k. Always the lower number, and the honest one
   * to quote when the claim is "the two parsers rank topics the same way": a short
   * LLM list scores badly here even when it contains no disagreement.
   */
  strict_overlap: number
  /** How many LLM skills mapped onto any topic at all. Low means a thin comparison. */
  llm_skills_mapped: number
  llm_skills_total: number
}

/**
 * Score each topic by how many of the LLM's skill strings hit its lexicon, running
 * them through the *same* normaliser the classical parser uses so that "Optimized
 * queries" and the lexicon's "optimise" land on one token.
 */
function topicsFromSkills(skills: string[]): { ranked: string[]; mapped: number } {
  const scores = new Map<string, number>()
  let mapped = 0

  for (const skill of skills) {
    const skillTerms = new Set(normalise(skill))
    let hit = false
    for (const topic of TOPICS) {
      for (const keyword of TOPIC_KEYWORDS[topic] ?? []) {
        const key = keyword.includes(' ')
          ? keyword.trim().toLowerCase().replace(/\s+/g, '_')
          : normalise(keyword)[0]
        if (key && skillTerms.has(key)) {
          scores.set(topic, (scores.get(topic) ?? 0) + 1)
          hit = true
        }
      }
    }
    if (hit) mapped += 1
  }

  const ranked = [...TOPICS]
    .filter(t => (scores.get(t) ?? 0) > 0)
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
  return { ranked, mapped }
}

export function compareWithLLM(
  classical: ParseResult,
  llmSkills: string[],
  k = 5
): ParserAgreement {
  const classicalTop = [...classical.topics]
    .filter(t => classical.evidence[t] > 0)
    .sort((a, b) => classical.evidence[b] - classical.evidence[a])
    .slice(0, k)

  const { ranked, mapped } = topicsFromSkills(llmSkills)
  const llmTop = ranked.slice(0, k)

  const shared = classicalTop.filter(t => llmTop.includes(t)).length
  // Denominator is the smaller list: if the LLM mapped onto only two topics, 2/2 is
  // full agreement on what it actually said, not 2/5 disagreement.
  const denominator = Math.min(classicalTop.length, llmTop.length)

  return {
    classical_top: classicalTop,
    llm_top: llmTop,
    overlap: denominator === 0 ? 0 : shared / denominator,
    strict_overlap: shared / k,
    llm_skills_mapped: mapped,
    llm_skills_total: llmSkills.length,
  }
}
