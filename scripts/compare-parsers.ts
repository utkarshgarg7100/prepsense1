/**
 * Baseline comparison: classical parser (Model 5) vs the LLM parser it replaced.
 *
 * Run: `npx tsx scripts/compare-parsers.ts`  (needs GROQ_API_KEY and MOCK_AI=false)
 *
 * This is the evidence for the Phase 1 claim that replacing the LLM parser with
 * TF-IDF did not cost accuracy. It prints, per fixture, which topics each side
 * ranks highest and how far they agree. Fixtures are the same documents used by
 * `ml/test_parser.py`, so the Python, TypeScript and LLM results are all directly
 * comparable.
 */

import { config } from 'dotenv'
import { getAIProvider } from '../lib/ai/router'
import { compareWithLLM } from '../lib/parse/agreement'
import { explainTopic, parseResumeAndJD, weakestTopics } from '../lib/parse/parser'

config({ path: '.env.local' })

const BACKEND_RESUME = `
Senior Backend Engineer, 6 years experience.
Designed and shipped a distributed order-processing system handling 40k requests
per second. Introduced caching and sharding to cut p99 latency from 800ms to 90ms.
Profiled and optimised hot paths in the matching algorithm; refactored the legacy
codebase and raised test coverage. Debugged production incidents and wrote the
root cause analysis documents.
`

const PM_RESUME = `
Product Manager, 4 years. Owned the roadmap for a customer-facing checkout
product. Ran user research and usability studies, built personas, and prioritised
features by measured impact. Drove A/B tests, tracked conversion and retention
metrics on the analytics dashboard, and reported ROI to stakeholders.
`

const LEADERSHIP_JD = `
Engineering Manager. You will lead and mentor a team of eight engineers, run
hiring and onboarding, and manage stakeholder relationships across product and
design. You will coach direct reports, resolve conflict and disagreement within
the team, negotiate priorities, and align cross functional partners toward
consensus. Strong communication and presentation skills required.
`

const BACKEND_JD = `
Backend Engineer. Build scalable distributed systems and microservices. You will
work on caching, sharding, load balancing, and high availability infrastructure,
optimising throughput and latency. Strong algorithm and data structure knowledge
required; you will debug and profile production systems.
`

const CASES: Array<[string, string, string]> = [
  ['backend CV vs engineering-manager JD', BACKEND_RESUME, LEADERSHIP_JD],
  ['backend CV vs backend JD', BACKEND_RESUME, BACKEND_JD],
  ['PM CV vs backend JD', PM_RESUME, BACKEND_JD],
]

async function main() {
  const ai = await getAIProvider()
  const overlaps: number[] = []

  for (const [name, resume, jd] of CASES) {
    console.log(`\n=== ${name} ===`)

    const started = Date.now()
    const classical = parseResumeAndJD(resume, jd)
    const classicalMs = Date.now() - started

    console.log('\nLargest gaps (classical):')
    for (const topic of weakestTopics(classical, 3)) {
      console.log(`  ${explainTopic(classical, topic)}`)
    }

    const llmStarted = Date.now()
    const llm = await ai.parseResume(resume)
    const llmMs = Date.now() - llmStarted

    const agreement = compareWithLLM(classical, llm.skills ?? [])
    overlaps.push(agreement.overlap)

    console.log(`\n  classical top topics: ${agreement.classical_top.join(', ')}`)
    console.log(`  LLM top topics:       ${agreement.llm_top.join(', ')}`)
    console.log(
      `  agreement:            ${(agreement.overlap * 100).toFixed(0)}% of the LLM's topics ` +
      `(${(agreement.strict_overlap * 100).toFixed(0)}% of the classical top-5)`
    )
    console.log(
      `  LLM skills mapped:    ${agreement.llm_skills_mapped}/${agreement.llm_skills_total}`
    )
    console.log(`  latency:              classical ${classicalMs}ms vs LLM ${llmMs}ms`)
  }

  const mean = overlaps.reduce((a, b) => a + b, 0) / overlaps.length
  console.log(`\nMean top-5 topic agreement across ${overlaps.length} cases: ${(mean * 100).toFixed(0)}%`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
