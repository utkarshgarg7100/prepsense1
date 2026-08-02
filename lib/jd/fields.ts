/**
 * Recovering a JD row's metadata from raw pasted text.
 *
 * A seeded JD arrives with company, role, tier and skills already filled in. A pasted
 * one is just prose, and those columns are not decoration — `role_type` and
 * `company_tier` are Postgres enums, and `company_name`/`role_subtype` are interpolated
 * straight into the interviewer prompt.
 *
 * Two rules shape this module:
 *
 * 1. **Nothing the model returns is trusted.** An invented `role_type` is rejected by
 *    the database at insert time, which surfaces to the user as "failed to save your
 *    job description" — an unhelpful message for a recoverable problem. Every enum is
 *    validated here and coerced to a safe default instead.
 *
 * 2. **The LLM is optional.** If Groq is rate-limited or down, a user must still be able
 *    to save a JD and start an interview. `heuristicFields` covers that with plain
 *    string work — worse metadata, but a working product. Same shape as
 *    `/api/resume/parse`, where the classical parser runs unconditionally and the LLM
 *    only adds what it cannot produce.
 */

import { getAIProvider } from '@/lib/ai/router'
import type { RawJDFields } from '@/lib/ai/types'
import type { CompanyTier, RoleType } from '@/types'

const ROLE_TYPES: RoleType[] = [
  'Software Engineering',
  'Product Management',
  'Business & Strategy',
  'Design',
  'Data & Analytics',
  'Operations',
]

const COMPANY_TIERS: CompanyTier[] = [
  'FAANG',
  'Indian Unicorn',
  'Global MNC',
  'Series B Startup',
  'Other',
]

export interface JDFields {
  company_name: string
  role_subtype: string
  role_type: RoleType
  company_tier: CompanyTier
  industry: string
  seniority: string | null
  required_skills: string[]
  nice_to_have_skills: string[]
  culture_tags: string[]
  /** Which path produced these fields — surfaced so the UI can invite a correction. */
  source: 'llm' | 'heuristic'
}

// ─── Validation ────────────────────────────────────────────────────────────

function cleanString(v: unknown, max = 120): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanList(v: unknown, max = 25): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of v) {
    const s = cleanString(item, 60)
    const key = s.toLowerCase()
    if (s && !seen.has(key)) {
      seen.add(key)
      out.push(s)
    }
    if (out.length >= max) break
  }
  return out
}

/**
 * Match an enum value case-insensitively, then fall back.
 *
 * Case-insensitive because "software engineering" is the same answer as
 * "Software Engineering" and rejecting it would discard a correct extraction over
 * capitalisation.
 */
function coerceEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const s = cleanString(value).toLowerCase()
  return allowed.find(a => a.toLowerCase() === s) ?? fallback
}

// ─── Heuristic fallback ────────────────────────────────────────────────────

/** Keyword hints for role_type, checked in order — first match wins. */
const ROLE_HINTS: Array<[RegExp, RoleType]> = [
  [/\b(product manager|product owner|apm|product management)\b/i, 'Product Management'],
  [/\b(data scientist|data analyst|analytics|machine learning|ml engineer|data engineer)\b/i, 'Data & Analytics'],
  [/\b(designer|ux|ui designer|product design)\b/i, 'Design'],
  [/\b(consultant|strategy|business analyst|growth|sales)\b/i, 'Business & Strategy'],
  [/\b(operations|program manager|project manager|supply chain)\b/i, 'Operations'],
  [/\b(engineer|developer|sde|programmer|architect|devops|sre)\b/i, 'Software Engineering'],
]

const SENIORITY_HINTS: Array<[RegExp, string]> = [
  [/\bintern(ship)?\b/i, 'intern'],
  [/\b(staff|principal)\b/i, 'staff'],
  [/\b(senior|sr\.?|lead)\b/i, 'senior'],
  [/\b(manager|head of|director)\b/i, 'manager'],
  [/\b(junior|jr\.?|entry[- ]level|graduate|fresher)\b/i, 'junior'],
]

/**
 * Metadata without an LLM.
 *
 * Deliberately modest. It reads the first few lines, where a job posting almost always
 * states its title and company, and looks for role keywords across the whole text. It
 * will often produce "Unknown" for the company — which is the honest answer, and better
 * than a confident wrong one, because the company name is spoken aloud by the
 * interviewer in the opening question.
 */
export function heuristicFields(jdText: string): JDFields {
  const head = jdText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8)
  const headText = head.join(' ')

  const roleLine = head.find(l => l.length < 90 && /\b(engineer|manager|designer|analyst|scientist|developer|consultant|lead|intern)\b/i.test(l))

  // "Backend Engineer at Acme" / "Acme — Backend Engineer" are the two common layouts.
  //
  // Matched line by line rather than across the joined header: a job posting puts the
  // location on the line after the title, so a pattern allowed to run past the line
  // break reads "at Acme Payments" as "Acme Payments Bengaluru". The line break is the
  // end of the name, so the match must respect it.
  let company = ''
  for (const line of head) {
    const atMatch = line.match(/\bat\s+([A-Z][\w&.\-]*(?:[ ][A-Z][\w&.\-]*)*)/)
    if (atMatch) {
      company = atMatch[1].trim()
      break
    }
  }
  if (!company) {
    const dashMatch = head[0]?.match(/^([A-Z][\w&.\- ]{1,40})\s*[—–\-|]/)
    if (dashMatch) company = dashMatch[1].trim()
  }

  const roleType = ROLE_HINTS.find(([re]) => re.test(jdText))?.[1] ?? 'Software Engineering'
  const seniority = SENIORITY_HINTS.find(([re]) => re.test(headText))?.[1] ?? null

  return {
    company_name: cleanString(company) || 'Unknown',
    role_subtype: cleanString(roleLine) || 'Custom Role',
    role_type: roleType,
    company_tier: 'Other',
    industry: 'Unknown',
    seniority,
    // Left empty on purpose. Guessing "skills" by keyword here would produce the noisy
    // word-soup that made CarrerPilot's extractor unusable, and the classical parser
    // (Model 5) already derives the topic gaps that actually drive the interview.
    required_skills: [],
    nice_to_have_skills: [],
    culture_tags: [],
    source: 'heuristic',
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

/**
 * Best-effort metadata for a pasted JD. Never throws: a failure here must not stop the
 * user saving their job description.
 */
export async function extractJDFields(jdText: string): Promise<JDFields> {
  const fallback = heuristicFields(jdText)

  let raw: RawJDFields
  try {
    raw = await (await getAIProvider()).extractJDFields(jdText)
  } catch (err) {
    console.warn('JD field extraction failed, using heuristics:', err instanceof Error ? err.message : err)
    return fallback
  }

  const company = cleanString(raw.company_name)
  const role = cleanString(raw.role_subtype)

  return {
    // A model that answers "Unknown" is telling the truth about a JD that never names
    // its company, so that answer is kept rather than replaced by the heuristic guess.
    company_name: company || fallback.company_name,
    role_subtype: role || fallback.role_subtype,
    role_type: coerceEnum(raw.role_type, ROLE_TYPES, fallback.role_type),
    company_tier: coerceEnum(raw.company_tier, COMPANY_TIERS, 'Other'),
    industry: cleanString(raw.industry) || 'Unknown',
    seniority: cleanString(raw.seniority, 30) || fallback.seniority,
    required_skills: cleanList(raw.required_skills),
    nice_to_have_skills: cleanList(raw.nice_to_have_skills),
    culture_tags: cleanList(raw.culture_tags, 10),
    source: 'llm',
  }
}
