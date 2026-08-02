/**
 * Resume / job-description parser (Model 5) — TypeScript port.
 *
 * Produces a per-topic **gap vector**: for each of the 15 topics, how much the job
 * asks for it versus how much the candidate's resume evidences it. That vector seeds
 * the starting mastery priors for Bayesian Knowledge Tracing, so a user's first
 * interview already targets their likely weak spots.
 *
 * `ml/parser.py` is the reference implementation and the one written up in the
 * report; this port exists so the app can run the parser without a Python process.
 * `ml/test_parity.py` asserts the two agree on which topics are the largest gaps.
 *
 * The one real divergence is lemmatisation. Python uses spaCy; there is no
 * equivalent here, so `normalise()` below applies conservative suffix rules plus a
 * small irregular-verb table. What makes this work is not linguistic accuracy but
 * *consistency*: the identical normaliser runs over the documents and over the
 * keyword lexicons, so both sides land in the same token space even where the
 * stemming is crude.
 */

import { PRIOR_CEILING, PRIOR_FLOOR, TOPIC_KEYWORDS, TOPICS } from './lexicon'

/** BKT's default starting prior. Mirrors `BKTParams.p_init` in `ml/bkt.py`. */
export const DEFAULT_PRIOR = 0.25

// Common English stop words. Kept short deliberately: TF-IDF already suppresses
// terms that appear across every document, so this only needs to remove the
// highest-frequency function words that would otherwise dominate raw term counts.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'his', 'i', 'in', 'into', 'is', 'it', 'its',
  'me', 'my', 'of', 'on', 'or', 'our', 'she', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'was', 'we', 'were', 'will',
  'with', 'you', 'your', 'am', 'do', 'does', 'did', 'so', 'if', 'not', 'no',
])

// Irregular verbs whose past tense a suffix rule cannot reach. Resumes are written
// almost entirely in the past tense, so without these the most important verbs on
// the page ("led a team", "built a service") never reach their lexicon entry.
const IRREGULAR: Record<string, string> = {
  led: 'lead', ran: 'run', built: 'build', drove: 'drive', wrote: 'write',
  taught: 'teach', grew: 'grow', made: 'make', took: 'take', built_out: 'build',
  brought: 'bring', began: 'begin', chose: 'choose', found: 'find', held: 'hold',
  kept: 'keep', met: 'meet', ran_into: 'run', sought: 'seek', spoke: 'speak',
  won: 'win', shipped: 'ship', oversaw: 'oversee', drew: 'draw',
}

/**
 * Reduce one token toward its dictionary form.
 *
 * Order matters: check the irregular table first, then strip suffixes longest-first
 * so that "-ations" is not left as "-ation" by an earlier "-s" rule.
 */
export function stem(token: string): string {
  if (IRREGULAR[token]) return IRREGULAR[token]
  if (token.length <= 3) return token

  // American/British spelling collapse, so "optimise" and "optimize" are one term.
  let t = token.replace(/is(e|ed|es|ing|ation)$/, 'iz$1')

  // Note there is deliberately no "-ation" -> "-ate" rule. It looks like an
  // improvement (it merges "communication" with "communicate") but it collapses
  // nouns into verbs that belong to *different* topic lexicons — "communication"
  // would land in `behavioral` via its "communicate" keyword — and it invents gaps
  // that the spaCy reference implementation does not see. spaCy leaves such nouns
  // alone; so do we. Caught by ml/test_parity.py.
  const rules: Array<[RegExp, string]> = [
    [/ies$/, 'y'],
    [/ements$/, 'ement'],
    [/ing$/, ''],
    [/edly$/, ''],
    [/ed$/, ''],
    [/es$/, ''],
    [/s$/, ''],
  ]
  for (const [pattern, replacement] of rules) {
    if (pattern.test(t)) {
      const candidate = t.replace(pattern, replacement)
      // Never stem down to a stub; "design"/"des" would collide with unrelated terms.
      if (candidate.length >= 3) {
        t = candidate
        break
      }
    }
  }

  // "optimize" -> "optimiz" -> restore a usable stem so the lexicon form matches.
  if (/[^aeiou]iz$/.test(t)) t = `${t}e`
  // Doubled final consonant left by "-ing"/"-ed" removal: "shipp" -> "ship".
  if (/([bdgklmnprt])\1$/.test(t)) t = t.slice(0, -1)

  return t
}

/** Multi-word keywords, longest first so "user research" is consumed before "user". */
const ALL_PHRASES: readonly string[] = Array.from(
  new Set(Object.values(TOPIC_KEYWORDS).flat().filter(kw => kw.includes(' ')))
).sort((a, b) => b.length - a.length)

/** Collapse a multi-word keyword into one token, matching `_phrase_key` in Python. */
function phraseKey(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * Lowercase, collapse known phrases, tokenise, drop stop words, and stem.
 * Returns the token list that TF-IDF consumes.
 */
export function normalise(text: string): string[] {
  if (!text || !text.trim()) return []

  let lowered = text.toLowerCase()
  // Phrases are substituted before tokenisation; splitting them first would lose
  // the phrase-level meaning that distinguishes "system design" from "design".
  for (const phrase of ALL_PHRASES) {
    if (lowered.includes(phrase)) {
      lowered = lowered.split(phrase).join(phraseKey(phrase))
    }
  }

  // Letters and underscores only: pure numbers (dates, bullet counts) are noise here.
  const tokens = lowered.match(/[a-z][a-z_]+/g) ?? []
  return tokens.filter(t => !STOP_WORDS.has(t)).map(t => (t.includes('_') ? t : stem(t)))
}

function lexiconDocument(topic: string): string[] {
  return (TOPIC_KEYWORDS[topic] ?? []).map(kw =>
    kw.includes(' ') ? phraseKey(kw) : stem(kw)
  )
}

/** Per-topic scores plus the terms that produced them. */
export interface ParseResult {
  topics: readonly string[]
  /** How strongly the JD asks for each topic, relative to its own strongest topic. */
  demand: Record<string, number>
  /** How strongly the resume evidences each topic, likewise self-relative. */
  evidence: Record<string, number>
  /** max(0, demand - evidence), in [0, 1]. */
  gaps: Record<string, number>
  matchedTerms: Record<string, string[]>
}

/**
 * TF-IDF weights for one document, using scikit-learn's default smoothing so the
 * numbers line up with the Python implementation.
 *
 * - sublinear tf: `1 + ln(count)`, which damps a term repeated twenty times in a
 *   long CV rather than letting it swamp the vector.
 * - smooth idf: `ln((1 + n) / (1 + df)) + 1`, the `smooth_idf=True` default.
 * - L2 normalised, so a later dot product is the cosine directly.
 */
function tfidfVector(
  tokens: string[],
  vocabulary: Map<string, number>,
  idf: Float64Array
): Float64Array {
  const vec = new Float64Array(vocabulary.size)
  const counts = new Map<number, number>()
  for (const token of tokens) {
    const index = vocabulary.get(token)
    if (index !== undefined) counts.set(index, (counts.get(index) ?? 0) + 1)
  }
  for (const [index, count] of counts) {
    vec[index] = (1 + Math.log(count)) * idf[index]
  }
  let norm = 0
  for (const value of vec) norm += value * value
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm
  }
  return vec
}

function cosine(a: Float64Array, b: Float64Array): number {
  let total = 0
  for (let i = 0; i < a.length; i++) total += a[i] * b[i]
  return total
}

/**
 * Scale a profile into [0, 1] against its own peak topic.
 *
 * Each document is normalised separately, making demand and evidence *relative
 * profiles* rather than absolute competence measures. A shared scale factor is
 * wrong: cosine is invariant to document length but not topical breadth, so a
 * short focused JD outscores a long broad CV on nearly every topic and even a
 * well-matched candidate shows gaps everywhere. See the same note in
 * `ml/parser.py:_rescale`.
 */
function rescale(values: number[]): number[] {
  const peak = values.length ? Math.max(...values) : 0
  if (peak <= 0) return values.map(() => 0)
  return values.map(v => Math.min(1, v / peak))
}

/**
 * Produce the per-topic gap vector for one (resume, JD) pair.
 *
 * Either document may be empty or unparseable; the result is still a full, valid
 * vector covering every topic. Everything downstream indexes this positionally, so
 * a short or malformed vector would corrupt the knowledge state silently.
 */
export function parseResumeAndJD(resumeText: string, jdText: string): ParseResult {
  const resumeTokens = normalise(resumeText)
  const jdTokens = normalise(jdText)
  const topics = TOPICS

  const zeros = () => Object.fromEntries(topics.map(t => [t, 0])) as Record<string, number>

  // Nothing survived normalisation: no demand, no evidence, no gap. Callers get
  // default priors, which is correct for "we know nothing about this candidate".
  if (resumeTokens.length === 0 && jdTokens.length === 0) {
    return {
      topics,
      demand: zeros(),
      evidence: zeros(),
      gaps: zeros(),
      matchedTerms: Object.fromEntries(topics.map(t => [t, []])),
    }
  }

  const lexicons = topics.map(lexiconDocument)
  const corpus = [resumeTokens, jdTokens, ...lexicons]

  // Fitting IDF on the two documents plus one pseudo-document per topic gives it 17
  // documents to discriminate on rather than 2, so terms common to every topic
  // lexicon are down-weighted automatically instead of by a hand-tuned stop list.
  const vocabulary = new Map<string, number>()
  for (const doc of corpus) {
    for (const token of doc) {
      if (!vocabulary.has(token)) vocabulary.set(token, vocabulary.size)
    }
  }

  const documentFrequency = new Float64Array(vocabulary.size)
  for (const doc of corpus) {
    for (const token of new Set(doc)) {
      documentFrequency[vocabulary.get(token)!] += 1
    }
  }
  const n = corpus.length
  const idf = new Float64Array(vocabulary.size)
  for (let i = 0; i < idf.length; i++) {
    idf[i] = Math.log((1 + n) / (1 + documentFrequency[i])) + 1
  }

  const resumeVec = tfidfVector(resumeTokens, vocabulary, idf)
  const jdVec = tfidfVector(jdTokens, vocabulary, idf)
  const topicVecs = lexicons.map(lex => tfidfVector(lex, vocabulary, idf))

  const evidence = rescale(topicVecs.map(tv => cosine(resumeVec, tv)))
  const demand = rescale(topicVecs.map(tv => cosine(jdVec, tv)))

  // Negative values — strengths the job did not ask about — are floored at zero
  // rather than kept as negative gaps: BKT priors cannot express "better than the
  // ceiling", and a strength in an untested area should not pull the interview
  // toward it.
  const gaps = demand.map((d, i) => Math.max(0, d - evidence[i]))

  // Terms present in the *documents*, not in the fitted vocabulary — the vocabulary
  // contains the topic lexicons themselves, so using it would claim a full keyword
  // match for a CV that mentioned none of them.
  const documentTerms = new Set([...resumeTokens, ...jdTokens])
  const matchedTerms = Object.fromEntries(
    topics.map(topic => [
      topic,
      (TOPIC_KEYWORDS[topic] ?? []).filter(kw =>
        documentTerms.has(kw.includes(' ') ? phraseKey(kw) : stem(kw))
      ),
    ])
  )

  const result: ParseResult = {
    topics,
    demand: Object.fromEntries(topics.map((t, i) => [t, demand[i]])),
    evidence: Object.fromEntries(topics.map((t, i) => [t, evidence[i]])),
    gaps: Object.fromEntries(topics.map((t, i) => [t, gaps[i]])),
    matchedTerms,
  }
  assertValid(result)
  return result
}

/** Gaps in the fixed topic order — the shape downstream code consumes. */
export function gapVector(result: ParseResult): number[] {
  return result.topics.map(t => result.gaps[t])
}

/** The n topics with the largest gaps — the interview's opening focus. */
export function weakestTopics(result: ParseResult, n = 5): string[] {
  return [...result.topics].sort((a, b) => result.gaps[b] - result.gaps[a]).slice(0, n)
}

/**
 * Convert gaps into BKT starting mastery priors.
 *
 * A large gap means the JD wants something the resume does not evidence, so priors
 * move down as gaps go up, interpolating between the default and `PRIOR_FLOOR`.
 * Topics with no gap sit slightly above the default, capped at `PRIOR_CEILING`:
 * evidence on a resume is weak proof of interview performance, which is the whole
 * reason the interview exists.
 */
export function toPriors(result: ParseResult, defaultPrior = DEFAULT_PRIOR): Record<string, number> {
  const priors: Record<string, number> = {}
  for (const topic of result.topics) {
    const gap = result.gaps[topic]
    priors[topic] = gap > 0
      ? defaultPrior - (defaultPrior - PRIOR_FLOOR) * gap
      : defaultPrior + (PRIOR_CEILING - defaultPrior) * result.evidence[topic]
  }
  return priors
}

/** Human-readable account of why a topic scored as it did. */
export function explainTopic(result: ParseResult, topic: string): string {
  const terms = result.matchedTerms[topic] ?? []
  const matched = terms.length ? terms.join(', ') : 'no keywords matched'
  return (
    `${topic}: demand=${result.demand[topic].toFixed(2)} ` +
    `evidence=${result.evidence[topic].toFixed(2)} gap=${result.gaps[topic].toFixed(2)} ` +
    `(${matched})`
  )
}

/**
 * Invariant check on the way out — the Phase 1 bug guard.
 *
 * Every consumer (BKT priors, the RL policy's observation vector, the report UI)
 * indexes this positionally, so a vector of the wrong length or with an
 * out-of-range value corrupts them all without raising anywhere near the cause.
 */
function assertValid(result: ParseResult): void {
  for (const [name, values] of [
    ['demand', result.demand],
    ['evidence', result.evidence],
    ['gaps', result.gaps],
  ] as const) {
    const keys = Object.keys(values)
    if (keys.length !== result.topics.length) {
      throw new Error(
        `parser: ${name} has ${keys.length} entries, expected ${result.topics.length}`
      )
    }
    for (const topic of result.topics) {
      const value = values[topic]
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`parser: ${name}[${topic}] = ${value} is outside [0, 1]`)
      }
    }
  }
}
