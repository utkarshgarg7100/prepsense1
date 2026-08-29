# PrepSense

An AI interview coach that **remembers you between sessions**.

Most interview-practice tools are stateless LLM wrappers: every session starts from
nothing. PrepSense keeps a per-topic model of what you actually know (Bayesian Knowledge
Tracing), carries it across sessions, and uses a reinforcement-learning controller to
choose what to ask next.

Five models, all wired into the running app:

| Model | What it does | Where it lives |
|---|---|---|
| 5 — Resume/JD parser | Reads CV + job description, finds skill gaps, seeds the scorecard | `ml/parser.py`, `lib/parse/` |
| 2 — Knowledge tracing (BKT) | Per-topic mastery that persists between sessions | `ml/bkt.py`, `lib/kt/` |
| 1 — RL curriculum controller | Picks the next (topic, difficulty) from the scorecard | `ml/train_ppo.py`, `ml/serve.py`, `lib/ai/chooser.ts` |
| 3 — LLM evaluation | Scores each answer against a rubric | `lib/ai/`, `lib/prompts/` |
| 4 — Speech-to-text | Transcribes spoken answers | `app/api/interview/transcribe/` |

## Documentation

**Contributing a model? Go straight to `ml/contrib/<your folder>/START_HERE.md`** — it is
self-contained and you do not need anything else on this list to begin.

| File | What it is |
|---|---|
| `TEAM_BRIEFING.md` | **Start here if you are new to the project** — what it is, the five models, how they connect, and what is honestly claimed |
| `PROGRESS.md` | What is built and why — the running decision log. The most useful file here. |
| `PHASES.md` | The build plan, and each phase's exit criterion |
| `RESEARCH_LOG.md` | Every experiment, including the failed ones. **Finding F9 is the project's central result.** |
| `EXAMINER_QA.md` | Anticipated viva questions and their answers |
| `REFERENCES.md` | Citations, and code adapted from elsewhere with what was and was not reused |
| `PROJECT_CONTEXT.md` | Original scope and problem statement |
| `BUILD_PLAN.md` | Early planning notes, kept for provenance |
| `COLLABORATION.md` | Git workflow, branch protection, review rules |
| `ml/README.md` | Ownership map for the Python package, and the frozen contract |
| `AGENTS.md` | Instructions for AI coding assistants working in this repo |

## Repository layout

```
app/                 Next.js routes and API handlers
components/          React UI
lib/                 TypeScript logic — ai/, kt/ (BKT), parse/, rl/, scoring/
ml/                  Python: BKT, parser, simulator, RL training, policy server
├── models/          trained policies (ppo_v6_seed0.zip is loaded at runtime)
├── runs/            TensorBoard logs — never delete, failed runs included
└── contrib/         collaborators' models (see ml/contrib/README.md)
supabase/migrations/ plain SQL, applied manually in numerical order
scripts/             standalone test and utility scripts
```

---

## Setup

### Prerequisites

- **Node 20+**
- **Python 3.12** — not 3.13/3.14. torch and Stable-Baselines3 wheel support is unproven
  there, and it only breaks once you reach the RL work.
- A **Supabase** project (free tier is fine)
- A **Groq** API key (free tier, 2,000 requests/day) — https://console.groq.com/keys
  Groq is the only supported provider, for both the LLM and speech-to-text.

### 1. Install and configure

```bash
git clone <repo> && cd prepsense
npm install
cp .env.example .env.local   # then fill in Supabase + Groq keys
```

`.env.example` lists every variable the code reads, with notes on which are optional.

### 2. Database

Migrations are plain SQL, applied **manually, in numerical order**, through the Supabase
dashboard SQL editor. There is no migration runner — paste each file from
`supabase/migrations/` in turn, starting at `001`.

Order matters: later migrations alter tables the earlier ones create. Skipping one tends
to surface much later and confusingly — for instance a missing `knowledge_state` shows up
as knowledge tracing silently doing nothing, because the store degrades rather than
throwing (by design: a failed write costs one data point, an exception would cost the
candidate their interview).

Then seed the sample job descriptions and companies:

```bash
npm run seed
```

### 3. Run

```bash
npm run dev     # http://localhost:3000
```

That is enough for a full working interview. The policy service below is optional.

---

## The `ml/` package (Python)

Everything model-related: BKT, the resume/JD parser, the student simulator, RL training,
and the policy server.

```bash
cd ml
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m spacy download en_core_web_sm
.venv/bin/python -m pytest -q          # 120 tests
```

`stable-baselines3` pulls in torch (~800MB). If you only want to work on the parser or
BKT, everything except `train_*.py`, `evaluate.py` and `serve.py` runs without it.

### Serving the trained policy (optional)

```bash
cd ml && .venv/bin/uvicorn serve:app --port 8000
```

**The app works without this.** `lib/ai/chooser.ts` falls back to a Thompson bandit and
then to the LLM's own question plan, so a stopped or slow policy service costs question
quality, not the interview. That chain is tested by `scripts/test-chooser.ts` — including
the service being down, returning a 500, and returning a topic that does not exist.

---

## Tests

The TypeScript-side checks are standalone scripts rather than a test runner, because most
of them verify behaviour against the live database or a live model:

```bash
npx tsc --noEmit                              # typecheck (must be clean)
npx tsx scripts/test-jd-extract.ts            # custom JD ingestion, offline
npx tsx scripts/test-rls.ts                   # row-level security isolation (live DB)
npx tsx scripts/test-reconcile.ts             # score reconciliation
npx tsx scripts/test-chooser.ts               # RL fallback chain
npx tsx scripts/test-knowledge-state.ts       # BKT persistence (live DB)
npx tsx scripts/test-knowledge-history.ts     # mastery trajectory (live DB)
npx tsx scripts/test-rl-experience.ts         # experience logging (live DB)
npx tsx scripts/test-jd-fields-live.ts        # JD metadata (live model — costs API calls)
npx tsx scripts/compare-parsers.ts            # classical vs LLM parser baseline
```

Python:

```bash
cd ml && .venv/bin/python -m pytest -q
```

The **parity tests** (`ml/test_bkt_parity.py`, `ml/test_parity.py`) are the important
ones. BKT and the parser exist in both Python and TypeScript, and those tests assert the
two implementations agree — BKT to 1e-12. Two implementations of the same maths in two
languages is the most likely source of a silent bug in this project.

---

## Working on this repo

- **Next.js 16 / React 19.** Per `AGENTS.md`, check `node_modules/next/dist/docs/` before
  writing framework-level code; several APIs differ from Next 14/15.
- **`NEXT_PUBLIC_DEV_BYPASS=true` skips auth** and makes the service-role client genuinely
  bypass row-level security. Convenient, but it hides RLS bugs — test with it `false`
  before believing anything works.
- **`MOCK_AI=true` returns canned responses.** Useful without an API key, but every topic
  then moves identically, which makes knowledge tracing unverifiable.
- **Never delete a failed training run.** `ml/runs/` and `RESEARCH_LOG.md` are the record
  the write-up depends on, negative results included.
- **`lib/kt/bkt.ts:DEFAULT_TOPICS` and `ml/bkt.py:DEFAULT_TOPICS` must stay in sync.** The
  policy's action space is indexed by that ordering, so reordering either side silently
  mis-maps every trained action.
