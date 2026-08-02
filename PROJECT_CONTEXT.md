# PrepSense — Project Context

## What is PrepSense?
AI-powered mock interview platform. Users pick a job description, do a live interview, get scored and a detailed report.

## Tech Stack
- **Framework**: Next.js **16.2.9** (App Router) + React 19.2.4
  - NOT Next 14 — per `AGENTS.md`, read `node_modules/next/dist/docs/` before framework-level changes
- **Database + Auth**: Supabase (PostgreSQL + RLS)
- **AI**: Pluggable provider — Gemini / OpenAI / LM Studio / Claude (set via `ACTIVE_AI_PROVIDER` in `.env.local`)
- **Styling**: Tailwind CSS + shadcn/ui
- **Language**: TypeScript

## Project Location
`/Users/utkarshgarg/Desktop/prepsense`

---

## Pages
| Route | File |
|---|---|
| `/` | `app/page.tsx` — Landing page |
| `/signup` | `app/(auth)/signup/page.tsx` |
| `/login` | `app/(auth)/login/page.tsx` |
| `/onboarding` | `app/onboarding/page.tsx` |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` |
| `/practice` | `app/(dashboard)/practice/page.tsx` — Pick a JD, start interview |
| `/interview/[id]` | `app/(dashboard)/interview/[id]/page.tsx` → `components/interview/InterviewRoom.tsx` |
| `/report/[id]` | `app/(dashboard)/report/[id]/page.tsx` |
| `/history` | `app/(dashboard)/history/page.tsx` |
| `/profile` | `app/(dashboard)/profile/page.tsx` |

---

## API Routes
| Route | Purpose |
|---|---|
| `POST /api/interview/start` | Creates session, generates question plan + first question |
| `POST /api/interview/answer` | Evaluates answer, saves to DB, returns next question |
| `POST /api/interview/complete` | Marks session done, computes scores, generates report |
| `POST /api/interview/transcribe` | Speech-to-text for voice mode |
| `POST /api/resume/upload` | Upload + parse resume PDF |
| `GET /api/report/[id]` | Fetch completed session report |
| `POST /api/auth/signup` | Server-side signup (wraps Supabase auth) |

---

## AI Provider System
`lib/ai/router.ts` — reads `ACTIVE_AI_PROVIDER` env var and returns the right provider.

Providers:
- `lib/ai/gemini.ts` — Google Gemini (model: `gemini-2.0-flash`)
- `lib/ai/openai.ts` — OpenAI (model: `gpt-4o`)
- `lib/ai/claude.ts` — Anthropic Claude
- `lib/ai/lmstudio.ts` — LM Studio local server (OpenAI-compatible, `http://localhost:1234/v1`)

Each provider implements `AIProvider` interface from `lib/ai/types.ts`:
- `generateQuestion(context)`
- `evaluateAnswer(question, answer, context)`
- `generateFollowUp(answer, claim, context)`
- `generateQuestionPlan(context)`
- `generateSessionReport(session)`
- `parseResume(text)`
- `buildGapMatrix(skills, jdText)`

---

## Database (Supabase)
Key tables:
- `profiles` — user profile (linked to `auth.users` via trigger)
- `job_descriptions` — seeded JD cards (id format: `se-fe-003`)
- `resumes` — user uploaded resumes
- `sessions` — interview sessions (status: `in_progress` | `completed`)
- `messages` — per-message transcript (role: `interviewer` | `candidate`)
- `session_scores` — computed scores after completion
- `speech_feedback` — filler words, pacing metrics
- `user_streaks` — daily streak tracking
- `user_achievements` — badges earned
- `user_weak_areas` — RL-style tag tracking (alpha/beta)
- `resume_markers` — AI annotations on resume lines

Migrations in `supabase/migrations/`:
- `001_initial_schema.sql` — core tables + RLS
- `002_seed_tables.sql` — seed JD data
- `003_fix_seed_schema.sql` — schema fixes
- `004_test_helpers_and_fixes.sql` — `create_test_auth_user` / `delete_test_auth_user` RPC functions
- `005_fix_trigger.sql` — resilient `handle_new_user` trigger

---

## Dev Bypass Mode
`.env.local` has `NEXT_PUBLIC_DEV_BYPASS=true` — skips auth checks in middleware, layouts, and API routes. Uses UUID `00000000-0000-0000-0000-000000000000` as the dev user (this user exists in Supabase `auth.users`).

Also `MOCK_AI=true` — skips all AI calls, returns hardcoded mock questions/evaluations/reports. Use this when no AI provider is available.

---

## .env.local (current state)
```
NEXT_PUBLIC_SUPABASE_URL=https://fghnccaxcmceolroobbr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

ACTIVE_AI_PROVIDER=groq       # groq | gemini | openai | claude | lmstudio
GROQ_API_KEY=...              # ACTIVE — free tier, 2000 req/day
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_WHISPER_MODEL=whisper-large-v3-turbo
GOOGLE_GEMINI_API_KEY=...      # quota exhausted
OPENAI_API_KEY=...             # insufficient_quota
ANTHROPIC_API_KEY=your-anthropic-api-key   # placeholder — not set
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=qwen/qwen3.5-9b

NEXT_PUBLIC_DEV_BYPASS=true
MOCK_AI=false                 # real AI is live again
```

---

## Supabase Clients
- `lib/supabase/server.ts` exports:
  - `createClient()` — anon key, respects RLS
  - `createServiceClient()` — service role key, bypasses RLS (used in API routes when `bypass=true`)
- `lib/supabase/client.ts` — browser client (anon key)

---

## Known Issues / Pending
1. **No working AI API key** — all 3 providers (Gemini, OpenAI, LM Studio) have quota/connectivity issues. Running in `MOCK_AI=true` mode.
2. **Supabase DNS slow on some networks** — pages slow when `fghnccaxcmceolroobbr.supabase.co` can't be resolved quickly.
3. **Interview answer route** — uses `db` (service client) in bypass mode to avoid RLS failures.
4. **Migration 005** should be run in Supabase SQL Editor if not already done (resilient trigger).

---

## Interview Flow (end-to-end)
1. `/practice` → user picks JD + round type → clicks Start
2. `JDSelector.tsx` → `POST /api/interview/start` → creates session + first question
3. Redirects to `/interview/[session-id]` → `InterviewRoom.tsx` loads
4. User types/speaks answer → `POST /api/interview/answer` → evaluation + next question
5. After 5 questions (mock) or `total_questions` → `POST /api/interview/complete`
6. Redirects to `/report/[session-id]`

---

## Key Components
- `components/interview/InterviewRoom.tsx` — 400+ line live interview UI (text + voice mode)
- `components/jd/JDSelector.tsx` — JD grid with filters, starts interview
- `components/jd/InterviewBriefModal.tsx` — pre-interview brief modal
- `lib/scoring/index.ts` — score aggregation, STAR compliance, filler word detection
- `lib/prompts/` — all AI prompts (interviewer system prompt, evaluation, report, etc.)

---

## How to Run
```bash
cd /Users/utkarshgarg/Desktop/prepsense
npm run dev
# App at http://localhost:3000
```
With `MOCK_AI=true` + `NEXT_PUBLIC_DEV_BYPASS=true`, the full flow works without any AI key or login.
