/**
 * Live check of custom-JD metadata extraction against the configured AI provider.
 *
 * `scripts/test-jd-extract.ts` covers the offline logic — what text we keep, what links
 * we refuse, what the heuristic fallback produces. This one answers the different
 * question: does the *model* actually recover company, role and skills from a real job
 * posting, and does it stay inside the two Postgres enums?
 *
 * Separated from the offline tests because it costs API calls and needs a key. Same
 * split as `scripts/compare-parsers.ts`.
 *
 * Run: `npx tsx scripts/test-jd-fields-live.ts`
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { extractJDFields } from '../lib/jd/fields'
import { parseResumeAndJD, weakestTopics, toPriors } from '../lib/parse/parser'

const results: Array<{ label: string; ok: boolean; detail: string }> = []
function check(label: string, ok: boolean, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

const ROLE_TYPES = [
  'Software Engineering', 'Product Management', 'Business & Strategy',
  'Design', 'Data & Analytics', 'Operations',
]
const TIERS = ['FAANG', 'Indian Unicorn', 'Global MNC', 'Series B Startup', 'Other']

// A realistic paste: title, company, location, prose, a requirements list. Not tidy.
const REAL_JD = `Senior Backend Engineer
Razorpay · Bengaluru, Karnataka, India · Full-time

About the role
We're looking for a Senior Backend Engineer to join our Payments Infrastructure team.
You will design and operate the services that move billions of rupees every day, working
closely with product and SRE to keep latency low and availability high.

What you'll do
- Design, build and own high-throughput payment services in Java and Go
- Improve the reliability of our Kafka-based event pipeline
- Work with PostgreSQL and Redis at scale; own schema design and query performance
- Mentor junior engineers and drive design reviews

What we're looking for
- 5+ years building backend systems in production
- Strong grasp of distributed systems, idempotency and consistency trade-offs
- Experience with Kubernetes and AWS
- Excellent communication; you can explain a trade-off to a non-technical stakeholder

Nice to have
- Experience in fintech or payments
- Exposure to gRPC

We move fast, we take ownership, and we obsess over our merchants.`

// A JD that names no company — the case where inventing one would be actively harmful,
// because the interviewer speaks the company name aloud in the opening question.
const ANON_JD = `Product Manager - Growth

We are a fast-growing consumer app looking for a Product Manager to own our growth
funnel. You will run experiments across activation and retention, work with data science
to size opportunities, and partner with design and engineering to ship.

Requirements: 3+ years in product management, strong SQL, experience with A/B testing
frameworks, and a track record of moving retention metrics.`

async function main() {
  console.log('provider: groq\n')

  // ── A real, fully specified JD ──────────────────────────────────────────
  console.log('── Senior Backend Engineer @ Razorpay ──')
  const f = await extractJDFields(REAL_JD)
  console.log(JSON.stringify(f, null, 2), '\n')

  check('used the model, not the fallback', f.source === 'llm', f.source)
  check('company recovered', /razorpay/i.test(f.company_name), f.company_name)
  check('role title recovered', /backend engineer/i.test(f.role_subtype), f.role_subtype)
  check('role_type is a legal enum value', ROLE_TYPES.includes(f.role_type), f.role_type)
  check('role_type is correct', f.role_type === 'Software Engineering', f.role_type)
  check('company_tier is a legal enum value', TIERS.includes(f.company_tier), f.company_tier)
  check('seniority recovered', !!f.seniority && /senior/i.test(f.seniority), String(f.seniority))
  check('industry recovered', f.industry !== 'Unknown', f.industry)

  const skills = f.required_skills.join(' | ').toLowerCase()
  check('required skills found', f.required_skills.length >= 3, `${f.required_skills.length} skills`)
  check('picked up core stated skills', ['java', 'go', 'kafka', 'postgres', 'kubernetes', 'aws']
    .filter(s => skills.includes(s)).length >= 3, skills)
  check('nice-to-haves kept separate',
    f.nice_to_have_skills.some(s => /fintech|payments|grpc/i.test(s)),
    f.nice_to_have_skills.join(', ') || '(none)')
  check('culture signals picked up', f.culture_tags.length > 0, f.culture_tags.join(', ') || '(none)')
  check('no skills invented from thin air',
    !skills.includes('php') && !skills.includes('django'),
    'skills must come from the JD text')

  // ── The unnamed-company case ────────────────────────────────────────────
  console.log('\n── Product Manager, no company named ──')
  const a = await extractJDFields(ANON_JD)
  console.log(JSON.stringify(a, null, 2), '\n')

  check('role_type correct for a PM role', a.role_type === 'Product Management', a.role_type)
  check(
    'unnamed company is admitted, not invented',
    /unknown/i.test(a.company_name),
    `${a.company_name} — the interviewer says this name aloud in question 1`
  )
  check('tier falls back to Other', a.company_tier === 'Other', a.company_tier)

  // ── The handoff the whole feature exists for ────────────────────────────
  // A custom JD is only useful if Model 5 can compare it against a resume, since that
  // comparison is what seeds the scorecard and steers the RL controller.
  console.log('\n── Model 5 against the custom JD ──')
  const RESUME = `Frontend developer with 4 years of React and TypeScript experience.
Built component libraries and design systems. Some Node.js. Comfortable with REST APIs,
Jest testing and CI pipelines. Led a team of two juniors on a redesign project.`

  const parsed = parseResumeAndJD(RESUME, REAL_JD)
  const gaps = weakestTopics(parsed, 5)
  const priors = toPriors(parsed)
  console.log('weakest topics:', gaps.join(', '))

  check('parser produced topic gaps from the custom JD', gaps.length === 5, gaps.join(', '))
  check('priors cover all 15 topics', Object.keys(priors).length === 15, `${Object.keys(priors).length}`)
  check('priors are inside the seeding band',
    Object.values(priors).every(v => v >= 0.08 && v <= 0.45),
    `min ${Math.min(...Object.values(priors)).toFixed(3)}, max ${Math.max(...Object.values(priors)).toFixed(3)}`)
  check(
    'a frontend CV vs a backend JD surfaces backend gaps',
    gaps.some(g => /system|scal|architect|data|debug/i.test(g)),
    gaps.join(', ')
  )

  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) {
    console.log('\nFailures:')
    for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.label} — ${r.detail}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('\nLive test failed to run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
