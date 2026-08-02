/**
 * Tests for custom JD ingestion — the pure parts of `lib/jd/extract.ts` and
 * `lib/jd/fields.ts`.
 *
 * No network and no database: this covers the logic that decides what text we keep,
 * what links we refuse, and what metadata we fall back to. The route itself is
 * exercised live afterwards.
 *
 * Run: `npx tsx scripts/test-jd-extract.ts`
 */

import { cleanPastedJD, htmlToText, JDExtractionError, _internals } from '../lib/jd/extract'
import { heuristicFields } from '../lib/jd/fields'

const { assertPublicUrl, selectJobContent } = _internals

const results: Array<{ label: string; ok: boolean; detail: string }> = []
function check(label: string, ok: boolean, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}
function throws(fn: () => unknown): boolean {
  try { fn(); return false } catch { return true }
}

// ─── Pasted text ───────────────────────────────────────────────────────────

check('empty paste is rejected', throws(() => cleanPastedJD('   ')))

const messy = 'Backend   Engineer\n\n\n\nWe  need:\n- Python\n- SQL'
const cleaned = cleanPastedJD(messy)
check('runs of spaces collapse', !cleaned.includes('   '), JSON.stringify(cleaned.slice(0, 20)))
check(
  'bullet line breaks survive',
  cleaned.includes('- Python\n- SQL'),
  'structure is information the field extractor uses'
)
check('blank-line runs capped at one', !cleaned.includes('\n\n\n'))

// ─── SSRF guard ────────────────────────────────────────────────────────────
// The important tests in this file. A server that fetches any address the user types
// will happily read the cloud metadata endpoint.

const blockedHosts = [
  'http://localhost:3000/x',
  'http://127.0.0.1/x',
  'http://0.0.0.0/x',
  'http://10.0.0.5/x',
  'http://192.168.1.1/x',
  'http://172.16.0.1/x',
  'http://172.31.255.1/x',
  'http://169.254.169.254/latest/meta-data/', // AWS/GCP instance metadata
  'http://db.internal/x',
  'http://printer.local/x',
  'http://[::1]/x',
]
for (const url of blockedHosts) {
  check(`refuses ${url}`, throws(() => assertPublicUrl(url)))
}

check('refuses file:// scheme', throws(() => assertPublicUrl('file:///etc/passwd')))
check('refuses non-url text', throws(() => assertPublicUrl('not a url')))
check('allows a public https link', !throws(() => assertPublicUrl('https://boards.greenhouse.io/acme/jobs/123')))
check(
  'allows a public host that merely looks private',
  !throws(() => assertPublicUrl('https://172.32.0.1.example.com/jobs')),
  '172.32 is outside the private 172.16-31 range'
)

// ─── HTML to text ──────────────────────────────────────────────────────────

const noisy = `
<html><head><title>t</title><style>.a{color:red}</style></head>
<body>
<nav>Home Jobs Login</nav>
<script>track()</script>
<main><h1>Backend Engineer</h1><p>Build APIs.</p>
<ul><li>Python</li><li>PostgreSQL</li></ul></main>
<footer>&copy; Acme &amp; Co</footer>
</body></html>`

const text = htmlToText(noisy)
check('script contents removed', !text.includes('track()'))
check('style contents removed', !text.includes('color:red'))
check('nav removed', !text.includes('Login'))
check('footer removed', !text.includes('Acme &'))
check('real content kept', text.includes('Backend Engineer') && text.includes('Build APIs.'))
check('list items become bullets', text.includes('• Python'), JSON.stringify(text))
check('entities decoded', htmlToText('<p>R&amp;D &ndash; 5&nbsp;years</p>').includes('R&D – 5 years'))
check('no leftover tags', !/[<>]/.test(text))

// ─── Container selection ───────────────────────────────────────────────────

const longBody = 'Responsibilities include building and operating services. '.repeat(8)
const withMain = `<body><nav>menu</nav><main><p>${longBody}</p></main><footer>f</footer></body>`
check('prefers <main> when it has real content', selectJobContent(withMain).includes('Responsibilities include'))

const shellMain = `<body><main><span>Loading…</span></main><div class="job-description"><p>${longBody}</p></div></body>`
check(
  'skips an empty <main> shell for the real container',
  selectJobContent(shellMain).includes('Responsibilities include'),
  'a 12-character <main> is layout, not the posting'
)

const noContainer = `<body><p>${longBody}</p></body>`
check('falls back to the whole page', selectJobContent(noContainer).includes('Responsibilities include'))

// ─── Heuristic fields (the no-LLM path) ────────────────────────────────────

const jd = `Senior Backend Engineer at Acme Payments
Bengaluru, India

We are looking for a senior backend engineer to build payment infrastructure.
Requirements: Python, PostgreSQL, distributed systems.`

const h = heuristicFields(jd)
check('company read from "at X"', h.company_name === 'Acme Payments', h.company_name)
check('role title recovered', /Backend Engineer/i.test(h.role_subtype), h.role_subtype)
check('role type inferred', h.role_type === 'Software Engineering', h.role_type)
check('seniority inferred', h.seniority === 'senior', String(h.seniority))
check('tier defaults to Other', h.company_tier === 'Other')
check('marked as heuristic', h.source === 'heuristic')
check(
  'no skills invented',
  h.required_skills.length === 0,
  'guessing skills by keyword is the noise Model 5 already avoids'
)

const pm = heuristicFields('Product Manager\nWe want a PM to own the roadmap.')
check('product roles detected', pm.role_type === 'Product Management', pm.role_type)

const anon = heuristicFields('We are hiring a data scientist.\nYou will build models.')
check('unnamed company is "Unknown", not invented', anon.company_name === 'Unknown', anon.company_name)
check('data roles detected', anon.role_type === 'Data & Analytics', anon.role_type)

const garbage = heuristicFields('asdf qwer zxcv')
check('garbage input still returns a valid row', ROLE_OK(garbage.role_type) && garbage.company_tier === 'Other')
function ROLE_OK(r: string) {
  return ['Software Engineering', 'Product Management', 'Business & Strategy', 'Design', 'Data & Analytics', 'Operations'].includes(r)
}

// ─── Summary ───────────────────────────────────────────────────────────────

const passed = results.filter(r => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
if (passed !== results.length) {
  console.log('\nFailures:')
  for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.label} ${r.detail}`)
  process.exit(1)
}
void JDExtractionError
