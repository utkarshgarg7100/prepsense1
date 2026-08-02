# PrepSense — Phased Build

Eight phases, built and connected **in order**. Each phase ends with the app still
working and something demonstrable. Nothing moves to the next phase until its exit
criterion passes.

**The rule that prevents bugs:** every phase integrates what it builds. No phase leaves
finished-but-unconnected code behind. The one exception is Phase 4 (RL training), which
is genuinely offline — and Phase 5 exists solely to connect it.

Legend: ⬜ not started · 🔨 in progress · ✅ done

---

## Phase 0 — Unblock and stabilise · *~half a day* · ✅

Nothing downstream can be trusted while the app returns fake AI scores.

- [x] Get one working AI provider — Groq free tier (2,000 req/day) or local LM Studio
- [x] Point `lib/ai/lmstudio.ts` or a new Groq provider at it; set `ACTIVE_AI_PROVIDER`
- [x] Set `MOCK_AI=false`, run a full interview end to end
- [x] Wire speech-to-text to the same free provider (`transcribe/route.ts`)
- [x] Confirm migration `005` is applied in Supabase
- [ ] Fix `PROJECT_CONTEXT.md`: Next.js **16.2.9 / React 19.2.4**, not 14
- [ ] Run once with `NEXT_PUBLIC_DEV_BYPASS=false` to catch RLS bugs the bypass hides

**Exit:** a real interview runs with real AI scores, typed *and* spoken, start to report.

**Why first:** the scorecard consumes Model 3's scores. Fake scores make every topic move
identically, so an integration bug and a working system look identical. This phase is
what makes Phase 2 verifiable at all.

---

## Phase 1 — Model 5: Resume/JD parser · *2 days* · ✅

Classical NLP per the diagram. Runs offline, no API key, fully explainable.

- [x] `ml/parser.py` — tokenise → lemmatise → TF-IDF → map keywords to the 15 topics
- [x] Topic taxonomy shared with `ml/bkt.py` (`DEFAULT_TOPICS`) — one source of truth
- [x] Output: per-topic gap score in `[0,1]`, usable directly as a BKT prior
- [x] `ml/test_parser.py` — known CV/JD pairs, expected topic hits, empty/garbage input (32 tests)
- [x] Compare against the existing LLM parser as a baseline; record agreement (`scripts/compare-parsers.ts`)
- [x] Expose to the app: `POST /api/resume/parse` calls it, LLM version kept as fallback

**Exit:** upload a real CV + JD, get sensible per-topic gap scores, tests pass.

**Bug guard:** assert output length always equals the topic count and every value is in
`[0,1]`, whatever the input. A malformed vector here corrupts every downstream phase
silently.

---

## Phase 2 — Model 2: Scorecard live in the app · *2 days* · ✅

- [x] `ml/bkt.py` + 18 passing tests
- [x] Migration `007_knowledge_state.sql` — `(user_id, topic, mastery, attempts, seeded_from,
      updated_at)`, unique on `(user_id, topic)`, RLS enabled. **Numbered 007, not 006:
      006 is `answer_duration`.** Applied and verified; `008` widens `mastery` to
      DOUBLE PRECISION.
- [x] `lib/kt/bkt.ts` — TypeScript port of `update()` and `score_to_observation()`
- [x] **Parity test** — `ml/test_bkt_parity.py`, 5 tests, exact to 1e-12
- [x] Call from `app/api/interview/answer/route.ts` after each evaluation (per answer, not
      at session end)
- [x] Seed new users' priors from the Phase 1 parser output (in `start/route.ts`)
- [x] Backfill: existing users start at the default prior rather than erroring (`getMastery`)

**Exit:** answer well at leadership twice, and that topic's number is visibly higher in the
database — and still higher in the *next* session. The app now has memory.

**Bug guard:** the parity test is the important one. Two implementations of the same maths
in two languages is the single most likely source of a silent bug in this project.

---

## Phase 3 — Student simulator · *3 days* · ✅

The environment the RL model trains in. Pure offline Python.

- [x] `ml/student_sim.py` — Gymnasium env wrapping BKT
- [x] State: 15 masteries + attempt counts + recent-correctness + session position
- [x] Action: (topic × difficulty) = 45 discrete actions
- [x] Reward: mastery gain − small time cost. **The re-asking penalty is implemented but
      defaults to off**: the gain term already decays to nothing as mastery rises, so an
      explicit penalty double-counts and rewards asking fewer questions. Kept as an
      ablation knob
- [x] `ml/baselines.py` — random, round-robin, weakest-first, Thompson bandit
      (port of `lib/rl/bandit.ts`)
- [x] Sanity checks: a random policy plateaus; an oracle policy does not; reward is
      bounded; episodes terminate

**Exit:** baselines run, produce sane and *different* mastery-gain numbers.

**Bug guard — the highest-risk phase.** A subtly wrong reward produces a beautiful
learning curve that means nothing. Watch for a policy that spams one topic (because gain
is steepest at low mastery) or games the episode-length cutoff. **If PPO later beats
weakest-first by an implausible margin, assume a reward bug before assuming success.**

---

## Phase 4 — Model 1: Train the chooser · *3 days* · ✅ *(concluded: RL ties the heuristic; cause identified)*

- [x] `ml/train_ppo.py` — Stable-Baselines3 PPO, TensorBoard logging
- [x] `ml/train_dqn.py` — DQN for the comparison the diagram specifies
- [x] Fixed seeds, checkpointed policies
- [x] `ml/evaluate.py` — policy vs. all four baselines on held-out simulated learners (paired, seeds from 100000)
- [x] `ml/sensitivity.py` — sweep BKT parameters, confirm the advantage holds across the
      plausible range (this replaces dataset fitting as the defensibility argument)
- [x] `ml/plot_results.py` — results plot with error bars
- [x] **Run the training** — 6 runs, E2–E11 in `RESEARCH_LOG.md`
- [x] Behaviour-cloning warm start + privileged-expert distillation control (F8)
- [ ] Record the outcome and write it up

**Exit:** a reproducible plot showing PPO beating weakest-first and random on
mastery-gain-per-question. **This is the project's central claim.**

---

## Phase 5 — Connect the chooser · *2 days* · ✅

- [x] Minimal FastAPI service: `POST /infer` → `(topic, difficulty)`, loads the frozen policy
      (`ml/serve.py`; observation built server-side, parity-tested against `InterviewEnv`)
- [x] `lib/ai/chooser.ts` — calls `/infer`, with a short timeout (1.5s, `AbortSignal.timeout`)
- [x] **Fallback chain:** policy → Thompson bandit → existing LLM question plan
      (`scripts/test-chooser.ts`, 13/13 — service down, 500, bad topic, slow, disabled)
- [x] Wire into `answer/route.ts`: chooser picks the topic, the LLM writes the question text
      (planned questions only — follow-ups stay reactive)
- [x] Log `(state, action, reward, next_state)` to an `rl_experience` table
      (`lib/rl/experience.ts`; migration 009 applied, `scripts/test-rl-experience.ts` 12/12)
- [x] Point `gapAreas` at the parser's `weakestTopics()` so the prompt and the controller
      name gaps in the same 15-topic vocabulary
- [x] Test with the service deliberately stopped — the app must degrade, not break
- [x] **Live run: policy service killed mid-interview, interview continued** ✅

**Exit:** ✅ **met.** A live interview where each question's topic is chosen by the trained
policy, and killing the Python service does not break the interview.

---

## Phase 6 — Knowledge Map dashboard · *2 days* · ✅

- [x] `GET /api/knowledge-map` reading `knowledge_state` (+ `knowledge_history` for trend)
- [x] Migration `011_knowledge_history.sql` — `knowledge_state` is overwritten on every
      answer, so "mastery over time" had no data behind it. Append-only log written beside
      the existing upsert (`scripts/test-knowledge-history.ts`, 14/14)
- [x] Lift the radar chart out of `components/report/ReportView.tsx` into
      `components/knowledge/TopicRadar.tsx`; the report now uses it too
- [x] Dashboard shows all 15 topics, mastery over time, weakest topics with tips
- [x] Empty state for users with no sessions yet
- [x] **Live run: finish an interview, return to the dashboard, see the map change** ✅

**Exit:** finish an interview, return to the dashboard, see the map visibly change.
**This is the demo.**

---

## Phase 7 — Harden and ship · *2–3 days* · ⬜

- [ ] Full flow with `NEXT_PUBLIC_DEV_BYPASS=false` and `MOCK_AI=false`
- [ ] Two different users get genuinely different question sequences
- [ ] Errors surface as UI messages, never blank screens
- [ ] Deploy (Vercel + a small host for `/infer`)
- [ ] Write-up: architecture, the five models, results plot, deviations from the diagram
      and their justification

**Exit:** deployed, a stranger can use it, results are written up.

---

## Order dependencies

```
Phase 0 ──> Phase 1 ──> Phase 2 ──> Phase 3 ──> Phase 4 ──> Phase 5 ──> Phase 6 ──> Phase 7
            (parser)    (scorecard)  (simulator)  (train)     (connect)   (dashboard)
                             ▲            │
                             └────────────┘
                        BKT is the simulator's core
```

- Phase 2 needs Phase 1 (parser seeds the priors) and Phase 0 (real scores to verify against)
- Phase 3 needs Phase 2's BKT — it *is* the simulator
- Phase 4 cannot start before Phase 3; there is nothing to train in
- Phase 6 needs Phase 2's data to display

## Running total

~16–17 working days ≈ **3 weeks**, with Phases 3 and 4 as the schedule risk.

## If time runs short

Phases 0–2 and 6 alone give a working, adaptive, demonstrable product using the Thompson
bandit as the chooser. Phases 3–5 are what satisfy the RL requirement. Cut nothing before
Phase 2 — without the scorecard there is no project.
