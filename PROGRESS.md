# PrepSense — Progress

Running log of what is actually done. Updated after each task.
Phase-by-phase task list in `PHASES.md`; rationale in `BUILD_PLAN.md`;
existing-system reference in `PROJECT_CONTEXT.md`.

**Currently:** Phases 0-4 done. Phase 4 concluded with a **bounded negative result**
(RL matches but does not beat weakest-first; cause identified as partial observability).
Next: Phase 5 — connect the chooser.

---

## Status: Day 1 of ~3 weeks

**Building 3 models.** Models 3 and 4 already existed in the codebase and are now live
on Groq — they were integrations, not build work.

| Model | What it does | Status |
|---|---|---|
| 5 — Resume/JD parser | Reads CV + job description, finds skill gaps, seeds the starting scorecard | ✅ Built, ported to TS, live in `/api/resume/parse` |
| 2 — Knowledge tracing (BKT) | The scorecard: per-topic mastery that persists between sessions | ✅ Live, verified against the database |
| 1 — RL curriculum controller | The chooser: picks the next (topic, difficulty) from the scorecard | ✅ Trained + evaluated; **ties** weakest-first, see RESEARCH_LOG F9 |
| 3 — LLM evaluation | Scores each answer against a rubric | ✅ Live on Groq (`MOCK_AI=false`) |
| 4 — Speech-to-text | Transcribes spoken answers | ✅ Live on Groq Whisper |

---

## Done

### Day 1 — BKT core (Model 2)
- `ml/` Python package created. **Python 3.12 venv** (`ml/.venv`) — deliberately not
  3.14, which is the system default here, because torch/Stable-Baselines3 wheel
  support for 3.14 is unproven and that would surface as a blocker in week 2.
- `ml/bkt.py` — evidence update, learning transition, `score_to_observation`
  threshold, and the `KnowledgeState` container that becomes the RL policy's
  observation vector.
- `ml/test_bkt.py` — **18 tests, all passing.** Property-based where possible so they
  survive parameter retuning; one hand-computed posterior case to catch an
  inverted Bayes update that property tests would miss.
- Topic taxonomy fixed at the 15 tags in `lib/rl/bandit.ts:DEFAULT_TAGS`.
  **These two lists must stay in sync** — the policy's action space is indexed by
  this ordering, so reordering either side silently mis-maps every trained action.

Run: `cd ml && .venv/bin/python -m pytest -q`

---

### Day 1 — Phase 0 complete (unblock)
- **Groq is live.** Key verified against the API, models confirmed, JSON mode tested.
- `lib/ai/groq.ts` — subclasses `LMStudioProvider` (both are OpenAI-compatible), so ~30
  lines instead of duplicating 195. Overrides `generate` to use native JSON mode, which is
  more reliable than the markdown-fence stripping the other providers do.
- Registered `groq` in `lib/ai/router.ts`; `ACTIVE_AI_PROVIDER=groq`, **`MOCK_AI=false`**.
- `transcribe/route.ts` now uses Groq's Whisper (`whisper-large-v3-turbo`) on the same
  key, falling back to OpenAI if `GROQ_API_KEY` is absent.
- **Fixed two pre-existing bugs** found by typechecking:
  - `resume/upload/route.ts` called `pdf-parse`'s v1 default-export function, which v2
    removed in favour of a `PDFParse` class — **every resume upload would have failed at
    runtime.** Also added `parser.destroy()`, without which each upload leaks a worker.
  - The `MOCK_AI` question plan in `start/route.ts` was missing `distribution` and
    `index`, and used free-text `category` values instead of the union type.
- `npx tsc --noEmit` is **clean**.

### Day 1 — Prior-art research
- `REFERENCES.md` written. Key finding: the relevant literature is **Computerized Adaptive
  Testing** and **learning path recommendation**, not "AI interview coach".
- `AiFangzhe/Exercise-Recommendation-System` uses our exact architecture (KT model →
  student simulator → deep RL policy), confirming the approach independently.
- `bigdata-ustc/EduSim` (MIT) and `bigdata-ustc/EduCAT` (MIT) are design references;
  EduCAT supplies stronger baselines (MFI, KLI) than random/weakest-first.
- **No existing interview coach uses RL or persistent knowledge tracing** — they are all
  LLM wrappers that forget between sessions. The adaptive-memory angle is the contribution.

---

## Decisions made

- **BKT parameters are hand-set, not fitted.** `p_guess` lowered to 0.08 (vs ~0.25
  typical) because an open-ended interview answer cannot be guessed into a good
  rubric score the way a multiple-choice question can. Defensibility comes from a
  sensitivity analysis, not from fitting to a math-tutoring dataset.
- **PPO trains against a simulated student, never live users.** Real usage yields ~50
  episodes; PPO needs 10⁴–10⁵. BKT is generative, so it can produce millions offline.
- **Integrate each model as it is built** — no big-bang integration at the end.
- **Model 5 built as classical NLP** (TF-IDF + spaCy), per the diagram, rather than
  the LLM approach currently in `app/api/resume/parse/route.ts`. It is explainable,
  free, offline, and genuinely the student's own work. The existing LLM version is
  kept as a comparison baseline.
- **Fallback chain:** RL policy → Thompson bandit → LLM question plan. Each layer
  ships independently, so a weak policy is not a broken product.

---

## Blockers

1. ~~No working AI provider.~~ **Resolved Day 1** — Groq free tier is live and
   `MOCK_AI=false`. Model 3 now returns real scores.
2. ~~Migration 006 not applied.~~ **Resolved Day 1** — applied via the dashboard SQL
   editor and verified against the live database: the column reads back, and a probe
   insert carrying `time_taken_seconds` was accepted (probe row then deleted).

---

## Known debt

- BKT will exist in both Python and TypeScript. Retuning parameters means changing
  both. Accepted for the 3-week timeline; a shared service would cost more than it saves.
- `lib/rl/bandit.ts` is a complete Thompson Sampling implementation imported by zero
  files. Becomes the fallback chooser in the integration step.
- `PROJECT_CONTEXT.md` says Next.js 14; actual is **Next 16.2.9 / React 19.2.4**.
  Per `AGENTS.md`, read `node_modules/next/dist/docs/` before framework-level changes.
- `zustand` is in `package.json` and used nowhere.

---

### Day 1 — Answer timing wired end-to-end
- Migration `006_answer_duration.sql` adds `messages.time_taken_seconds`. **Applied and
  verified against the live database.**
- `InterviewRoom.tsx` now sends the on-screen timer with each answer; the answer route
  persists it; `complete/route.ts` uses the measured value and only falls back to the
  word-count estimate for rows that predate the column.
- Effect: the "pace" line in the report is now a real speaking-speed measure instead of
  an answer-length proxy, and the RL controller gets its time-to-answer feature.

---

### Day 1 — Filler-word metric fixed
- Root cause: Whisper is trained on cleaned captions and deletes "um"/"uh" by default.
  Fix is a `prompt` full of fillers + `temperature: 0` on the transcription call, which
  biases the decoder toward a verbatim transcript.
- `FILLER_WORDS` split into `HESITATIONS` (speech-only sounds) and `DISCOURSE_MARKERS`
  (survive both typing and ASR cleanup). Zero hesitations across an entire interview is
  not plausible speech, so `computeSpeechMetrics` now returns
  `filler_confidence: 'measured' | 'understated'`, and the report shows "12+" with a
  caveat rather than a green "0" the model never actually observed.

---

### Day 1 — Model 5 core: resume/JD parser
- `ml/parser.py` — lemmatise (spaCy) → TF-IDF → cosine against 15 hand-built topic
  lexicons → per-topic **gap vector**. `ml/test_parser.py`: **32 tests, all passing**
  (50 total in `ml/`).
- Multi-word keywords ("system design", "root cause") are collapsed to single tokens
  *before* lemmatisation, longest-first, or the phrase meaning is lost.
- TF-IDF is fitted on 17 documents (resume + JD + one pseudo-document per topic) rather
  than 2, so IDF has enough to discriminate on and common words self-suppress.
- `priors()` maps gaps into BKT starting mastery within a **narrow band (0.08–0.45)**.
  Keyword matching on two short documents should nudge where the interview starts, not
  assert incompetence — BKT's own evidence updates should be what move mastery.
- **Two bugs the tests caught, both real:**
  - `explain()` checked the fitted vocabulary, which contains the topic lexicons
    themselves — so it claimed a full keyword match for a CV mentioning none of them.
  - A shared demand/evidence scale factor looked more principled but is wrong: cosine is
    invariant to document *length* but not *breadth*, so a short focused JD beat a long
    broad CV on nearly every topic. Each profile is now self-normalised.
- **Known limitation, pinned by a test:** self-normalising means one topic per document
  scores 1.0, so the JD's top topic keeps a residual gap unless it is also the CV's top
  topic. Acceptable because gaps only nudge priors within the band above.
- Sanity check on a backend CV: vs. a backend JD the largest gap is 0.36; vs. an
  engineering-manager JD it is leadership 1.00 and conflict 0.88. Correct behaviour.

---

### Day 1 — Model 5 ported to TypeScript
- **Decision: port, don't bridge.** `lib/parse/parser.ts` reimplements the parser so the
  app needs no Python process at runtime. A FastAPI sidecar was the alternative; rejected
  because a second service to keep alive during a demo is a worse failure mode than
  duplicated logic. Same call the BKT port makes.
- `lib/parse/lexicon.ts` is **generated** from `ml/parser.py` — not hand-written.
- TF-IDF reimplemented to match scikit-learn's defaults (sublinear tf, smooth idf, L2).
- The real divergence is lemmatisation: no spaCy in TS, so `stem()` uses suffix rules
  plus an irregular-verb table (resumes are all past tense — "led", "built", "wrote"
  never reach their lexicon entry without it). What makes it work is that the *same*
  normaliser runs over documents and lexicons, so both land in one token space.
- `ml/test_parity.py` — **14 tests.** Asserts the two agree on *which* topics are gaps
  and their ranking, plus a lexicon-drift guard. Deliberately **not** equal floats:
  magnitudes differ ~0.2 because of the stemmer, and forcing equality would mean
  degrading the spaCy reference implementation to match the crude one.
- **Bug the parity test caught:** an `-ation` → `-ate` stemming rule looked like an
  improvement but collapsed "communication" into the `behavioral` lexicon's
  "communicate", inventing a gap Python never saw. Removed.
- **64 tests passing** in `ml/`; `npx tsc --noEmit` clean.

---

### Day 1 — Model 5 wired into the app, LLM baseline measured
- `POST /api/resume/parse` now runs the classical parser **first and unconditionally**.
  It is local, deterministic and free, so the endpoint still returns skills and a gap
  vector when Groq is rate-limited or down. The LLM call is wrapped in a `try` and only
  adds what TF-IDF cannot produce (structured experience/education/projects); its
  failure degrades the response rather than 500-ing it. `source` in the response says
  which path ran.
- New optional `jd_id` on the request. Without a JD there is no demand signal and so no
  real gap — the parser still reports which topics the resume evidences, which is what
  upload-time parsing needs before the user has chosen a job.
- `lib/parse/agreement.ts` — the two parsers are **not** directly comparable (15 fixed
  topics vs free-text skill strings), so both are projected onto the topic taxonomy and
  compared there, using the same normaliser on both sides.
- `scripts/compare-parsers.ts` — the Phase 1 baseline evidence. Result on the three
  fixtures, against live Groq:

  | | classical | LLM |
  |---|---|---|
  | Latency | 1–6 ms | 590–880 ms |
  | Cost | zero | per-call |
  | Top-topic agreement | — | **100%** of the topics the LLM named were also in the classical top 5 |

- **The 100% needs its caveat, and the script prints both numbers.** The LLM maps onto
  only 2–3 topics, so "100% of the LLM's topics" is the fair reading; measured against
  the classical top-5 it is 40–60%. The honest claim is *no disagreement*, not
  *identical ranking* — the classical parser simply says more.
- Conclusion for the report: the LLM parser is ~150× slower, costs money, and adds no
  topic-level information the classical parser missed. It stays only for the structured
  fields, which is a formatting job rather than a modelling one.

---

### Day 1 — Phase 2: the scorecard is live in code
- `lib/kt/bkt.ts` — TypeScript port of `ml/bkt.py`. Unlike the parser port, this one is
  pure arithmetic with no linguistic step, so `ml/test_bkt_parity.py` asserts the two
  agree to **1e-12**, not merely in ranking. It checks single steps across a
  parameter × mastery grid, the 59.9/60.0 threshold boundary, and multi-step
  trajectories — single steps agreeing is not enough, because errors compound over a
  session. **5 tests; 69 passing in `ml/` overall.**
- Migration `007_knowledge_state.sql` — **007, not 006 as PHASES.md said**; 006 is
  `answer_duration`. Adds `seeded_from ('default'|'parser'|'observed')` so a prior
  guessed from a thin CV can be told apart from mastery the candidate actually earned.
- `lib/kt/store.ts` — all I/O, kept out of the maths module so BKT stays testable
  without a database. **Every function degrades rather than throws.** Knowledge tracing
  is layered onto a working interview: a missing table or failed write costs one data
  point, but an exception would cost the candidate their interview. The missing-table
  warning fires once per process, not once per answer.
- Wired into `answer/route.ts` (per answer, so an abandoned interview still keeps what
  it earned) and `start/route.ts` (seeds priors from the Model 5 parser).
- **Seeding uses `ignoreDuplicates`, not upsert.** A prior derived from keyword
  matching on two documents must never overwrite mastery earned by answering questions.
- **Modelling decision:** the observation is `depth_score` alone. The rubric produces
  only two numbers, and the other — `star_compliance` — measures whether the answer
  followed the STAR *format*. Worth coaching, but wrong as evidence of mastery: a
  correct system-design answer has no "Situation" or "Result" and would score as
  ignorance.
- **Simplification, stated for the report:** a question tagged with three topics updates
  all three from the same outcome. Textbook BKT assumes one skill per item; attributing
  credit between co-tagged topics needs a multi-skill model and data to fit it, neither
  of which this project has.
- **Bug found while wiring:** the `MOCK_AI` evaluation object in `answer/route.ts`
  carried four fields the rubric never produces (`relevance_score`, `clarity_score`,
  `feedback`, `improvement_areas`) and omitted two it does (`answer_summary`,
  `strong_answer_example`). Mock mode was exercising a different shape than production.
  Typing the variable as `AnswerEvaluation` is what caught it.

---

### Day 1 — Phase 2 verified against the live database
- Migrations `007` and `008` applied. `scripts/test-knowledge-state.ts` drives the real
  `lib/kt/store.ts` functions (not a reimplementation) and passes **13/13**, including
  the exit criterion: seed leadership at 0.080, answer well twice, read **0.941** back
  in a fresh session with no session context. That is the memory an LLM wrapper lacks.
- **Bug found by the test: `mastery` was `REAL`.** Single precision, ~7 significant
  digits, so every write quantised the posterior — 0.414038818359375 read back as
  0.414039. Small, but in the worst place: the RL policy trains against the Python
  student model and runs against stored TypeScript state, and `test_bkt_parity.py`
  pins those to 1e-12. The error also compounds, since each update is a function of
  the previous *stored* value. Migration `008` widens it to DOUBLE PRECISION; verified
  bit-identical on round-trip. Only caught because the test asserted untouched topics
  stay *exactly* untouched — a tolerance of 1e-6 would have passed.

---

### Day 1 — Graded evidence replaces the pass/fail threshold (saturation fix)
- **The problem.** Two passing answers moved a topic 0.08 → 0.94, and four reached
  1.000. Correct BKT behaviour given `p_guess = 0.08` — if guessing is near-impossible,
  a correct answer is near-conclusive — but the scorecard then flattens after two
  questions, and Model 1's entire job is to choose between those fifteen numbers. A
  policy trained on a flat scorecard learns nothing and *still produces a convincing
  learning curve*, which is the Phase 3 bug guard's exact warning.
- **The cause was information being thrown away.** Model 3 grades every answer 0-100,
  and `score_to_observation` collapsed that to pass/fail at 60 — making a 61 identical
  to a 99, and a 59 identical to a 12.
- **The fix.** `observation_confidence()` maps the score through a logistic centred on
  the pass mark (60 → 0.5), and `update_soft()` takes the expected posterior: run the
  BKT update both ways, weight by confidence. Not a new model — at confidence 1 or 0 it
  reduces *exactly* to the old update, which is what keeps the two comparable as a
  single swept parameter in Phase 4 rather than as two rival models. Pinned by a test.
- Effect on the same sequence (82, 76, 68, 71):

  | | old (pass/fail) | new (graded) |
  |---|---|---|
  | after 2 answers | 0.941 | 0.736 |
  | after 4 answers | **1.000** | 0.762 |

  A barely-passing 68 now nudges mastery *down* slightly, which is right: scoring 68
  when the model already believes you are strong is not evidence of further mastery.
- `SOFTNESS = 15` — the score gap worth about one logistic unit. An 85 is strong
  evidence (0.82), a 65 only mildly positive (0.63). This is a hand-set assumption like
  the other four and goes into the Phase 4 sensitivity sweep.
- Ported to `lib/kt/bkt.ts`; parity extended to cover the logistic and the graded
  update across the full grid, still at **1e-12**. **82 tests in `ml/`**, 13/13 on the
  live database, `tsc` clean.

---

### Day 1 — Phase 3: the student simulator
- `ml/student_sim.py` — Gymnasium environment. **Two levels of state, deliberately:**
  the simulated candidate has hidden `true_mastery`, while the policy observes only the
  BKT estimate built from observed scores through the same code path production uses.
  A policy trained on true mastery would be learning from information that does not
  exist at inference time. The *reward*, though, is computed on true mastery — the
  policy is graded on what the candidate really learned, not on what the system talked
  itself into believing. There is a test for exactly that.
- **What makes it a real RL problem** rather than a sort: learning follows a zone of
  proximal development. A question far below the candidate teaches nothing, and one far
  above teaches nothing either, so difficulty has to be matched to an ability that is
  only known noisily. Answers are generated with a 2-parameter IRT model and produce
  *graded* 0-100 scores, so the simulator exercises the same graded-evidence path the
  app now uses.
- Candidates are sampled per episode (Beta(2,3) mastery, varied learning rate, ZPD
  width, score noise, discrimination). A policy that meets one learner memorises it.
- `ml/baselines.py` — random, round-robin, weakest-first, Thompson (port of
  `lib/rl/bandit.ts`), plus an oracle that cheats. **Every baseline gets the same
  difficulty-matching helper**, or any PPO advantage would be an artefact of the
  comparison rather than evidence of learning.
- **Baseline results** (300 episodes, 20 questions each, mean true mastery gain):

  | policy | gain | ± stderr | topics used |
  |---|---|---|---|
  | random | 0.0867 | 0.0015 | 11.3 |
  | round-robin | 0.1199 | 0.0019 | 15.0 |
  | thompson | 0.1246 | 0.0019 | 14.3 |
  | **weakest-first** | **0.1263** | 0.0019 | 15.0 |
  | *oracle (cheats)* | *0.1551* | *0.0020* | *9.8* |

  The ordering is the one it should be, and the **0.1263 → 0.1551 gap is the headroom
  PPO is being asked to find** — about 23%. Beating `random` proves nothing;
  **weakest-first is the real bar**, because it is what a competent engineer would
  build in thirty lines without any RL at all.
- `ml/test_student_sim.py` — **24 tests.** Less about individual functions than about
  whether the learning problem is well posed: learnable (oracle > random), non-trivial
  (oracle > weakest-first by >10%), reward bounded, reward not payable by moving the
  *belief* without teaching, seeds reproducible, Gymnasium checker clean.
- **The reward-hacking check earned its keep, and caught me first.** `PHASES.md` warns
  about a policy that spams one topic. My initial spam policy scored *identically* to
  weakest-first — because re-computing `argmin` each step **is** weakest-first: a topic
  stops being weakest once asked. A genuine spammer has to lock its choice; that one
  scores **0.037 against 0.126**, worse than random, because the headroom term decays.
  Now a permanent test.
- `ml/requirements.txt` added, pinning the versions (including the Phase 4 ones).
- **106 tests passing in `ml/`.**

---

### Day 1 — Phase 4 scripts ready (training not yet run)
- `train_ppo.py` (primary), `train_dqn.py` (the comparison the diagram asks for),
  `evaluate.py`, `sensitivity.py`, `plot_results.py`. Every hyperparameter carries a
  comment saying why it is that value, since "why n_steps=256?" is a viva question.
- **PPO is primary and DQN is the comparison, not a coin flip.** 45 discrete actions on
  a 20-step horizon: PPO is far less hyperparameter-sensitive, and DQN's replay buffer
  holds early transitions from a bad policy for a long time when episodes are this
  short. If DQN loses, that is a reportable result rather than a failure.
- **`evaluate.py` is built to be hard to fool.** Evaluation seeds start at 100 000 so
  students are genuinely held out; every policy sees the *same* seed sequence, making
  it a paired comparison; the headline metric is true mastery gain rather than reward,
  because reward includes our shaping choices; and it prints a paired t-statistic and
  Cohen's d, since a difference smaller than the noise is not a result.
- **It also warns on results that are too good.** If the trained policy beats the
  cheating oracle, the script says to treat it as a bug — an observation leak or a
  reward error — rather than a breakthrough.
- Verified end-to-end on baselines only, no torch needed: 150 held-out students give
  random 0.0794, round-robin 0.1145, thompson 0.1192, weakest-first 0.1211, oracle
  0.1476. Consistent with the Phase 3 numbers on a different seed range.
- Not installed: `stable-baselines3` + torch (~800MB). **That install and the training
  run are the user's to do**, with guidance — this is the part of the project that has
  to be defended in person.

---

### Day 2 — Phase 4 runs 1-3, and the finding that reshaped the environment
Three training runs, each failing for a *different* diagnosable reason. Kept in full
because the debugging is the substance of the RL work.

| run | change | gain | vs weakest-first (0.1238) |
|---|---|---|---|
| v1 | 300k steps, defaults | 0.1063 | −14.1% |
| v2 | 1.5M steps, ent_coef 0.02, reward norm | 0.1108 | −10.5% |
| v3 | + attempts-feature fix | 0.1166 | −5.8% |

- **v1 diagnosis.** The reward curve rose 13.4 → 15.7, which looked like learning. It
  was not: measuring *behaviour* showed the policy picked "easy" 100% of the time and
  its topic choice had mean weakness-rank 7.0 — identical to random. It had learned a
  fixed, state-independent habit. **The lesson: a rising reward curve is not evidence
  of learning; behavioural metrics are.**
- **v2** raised exploration and normalised rewards (episode returns were dominated by
  the candidate's unobservable learning rate, which varies 2.6×). Difficulty use
  improved to 69/31 easy/medium, but topic rank stayed ~6.5. Partial improvements like
  this are the trap in RL debugging — they feel like confirmation and point away from
  the real cause.
- **v3: a genuine bug in the environment, mine.** Attempt counts were normalised by
  episode length, so "I already asked this topic" registered as **0.05** beside mastery
  features swinging by 0.5. Repeating a topic is the costliest available mistake, since
  gain scales with headroom — and the policy could not see it. It covered 10 of 15
  topics and lost to round-robin, which has no intelligence at all but never repeats.
  Fixed to `min(1, attempts/3)`; coverage rose to 12.9 and rank to 4.9.

**Then the finding that mattered more than any of them.** Before retraining again, I
measured the *observation-limited* ceiling — the best policy achievable using only what
the agent can actually see:

| | gain | sees |
|---|---|---|
| weakest-first | 0.1263 | observation |
| best greedy heuristic | **0.1274** | observation |
| oracle | 0.1551 | **hidden state** |

**The environment was nearly saturated by a thirty-line heuristic: ~1% of headroom.**
The 23% "gap to the oracle" quoted in Phase 3 was mostly *information* no deployable
policy could ever have, not strategy. More training could not have fixed this, and I
should have measured it in Phase 3 rather than after three training runs.

### Day 2 — Morale dynamics: making sequencing matter
- Decision taken with the user: extend the environment rather than report a negative
  result. `SimulatedStudent.morale` falls after poor answers and recovers after good
  ones, scaling both how well the candidate answers and how much they absorb.
- **Independently justified, not reverse-engineered to favour RL:** self-efficacy and
  affect effects are well documented in education research, and it is why human
  interviewers open with a warm-up. Parameters are hand-set and swept, like BKT's.
- **It changes the character of the problem, not just its difficulty:**

  | policy | before morale | with morale |
  |---|---|---|
  | weakest-first | 0.1263 | 0.0756 |
  | greedy-oracle (perfect info, no planning) | 0.1551 | **0.0695 — now loses** |
  | lookahead-oracle (perfect info + planning) | — | **0.0808 (+6.9%)** |

  A policy that knows the candidate perfectly and chooses greedily now **loses to
  weakest-first**, because chasing immediate learning walks the candidate into a run of
  failures. The headroom now comes from *sequencing*, which is what RL is for.
- `OraclePolicy` split into `GreedyOraclePolicy` (kept **because it loses** — it is the
  evidence that information alone is insufficient) and `LookaheadOraclePolicy` (the
  ceiling). Three Phase 3 tests assumed the greedy oracle was an upper bound and now
  assert the opposite.
- One test failed on a *statistical* error of mine, not a modelling one: it compared
  independent standard errors when both policies run on identical students. Switched to
  the paired test `evaluate.py` already used. **109 tests passing.**

---

### Day 2 — Phase 5 step 1: the policy is served
- `ml/serve.py` — FastAPI, `POST /infer` and `GET /health`, loads `ppo_v6_seed0.zip` once
  at startup. Loading per request would add ~200ms to a call the app gives a 1.5s budget,
  so the fallback would fire on a *healthy* service under load.
- **A service here, though the parser and BKT were ported to TypeScript instead.** Those
  are arithmetic; this is a torch network, and reimplementing an MLP forward pass in TS
  risks serving a policy that is subtly not the one that was evaluated. The fallback chain
  is what makes the extra process affordable.
- **The request carries state, not a feature vector.** The app sends mastery, attempts and
  the scores so far; `serve.py` assembles the 35-float observation itself. Building it in
  TypeScript would put the feature layout in two places, and a mis-ordered vector does not
  raise — it returns a confident, *wrong* topic.
- `ml/test_serve.py` — **9 tests.** The load-bearing one is `test_matches_env_observation`:
  it steps the real `InterviewEnv` and asserts the service's observation matches
  `_observation()` at every step, on state neither implementation authored. Same treatment
  as the BKT parity test, for the same reason.
- Smoke-tested live against the trained policy: weak leadership among strong topics →
  it asks leadership. **Two honest observations:** every response so far chose `easy`,
  which echoes the difficulty bias seen during training; and on a struggling candidate it
  did *not* pick the weakest topic. Both are consistent with a policy that ties
  weakest-first rather than reproducing it, and neither is a serving bug — the parity test
  rules that out.
- `fastapi` / `uvicorn` pinned in `requirements.txt`. **91 tests in `ml/`.**

---

### Day 2 — Phase 5 step 2: the fallback chain
- `lib/ai/chooser.ts` — `chooseNextQuestion()` returns `(topic, difficulty, source)` and
  **never throws and never returns null**. Three layers: trained policy → Thompson over
  the stored scorecard → hand back to the LLM prompt. 1.5s timeout via
  `AbortSignal.timeout`, which also covers a *hung* connection; a plain promise race would
  leave the socket open and hold the response.
- **Checked rather than assumed, per `AGENTS.md`:** `node_modules/next/dist/docs` confirms
  route handlers and POST `fetch` are uncached by default in Next 16, so no `no-store` is
  needed and adding one would have been cargo cult.
- The service's reply is **validated, not trusted**. An unrecognised topic is the
  dangerous case — it would flow onward and tag an answer against a topic the scorecard
  has no row for — so it falls back instead.
- **A real bug the test caught, and the interesting one of this phase.** The first arm
  construction was `Beta(1 + m·n, 1 + (1−m)·n)` with `n = attempts`. With one attempt
  each, all fifteen distributions overlapped and the *weakest* topic was chosen only
  **19%** of the time against a 6.7% random floor — a fallback barely better than chance.
  The cause is conceptual, not arithmetic: **BKT mastery is already a posterior that has
  integrated every past answer, including from earlier sessions.** Weighting it by attempt
  count treats the tracing model's entire output as a single observation. Adding a base
  `BELIEF_CONCENTRATION = 6` (attempts still sharpen it) took the weak topic to **92%**.
- `scripts/test-chooser.ts` — **13/13**, and it is the Phase 5 exit criterion. Exercises
  every way a separate process fails: not started (port 1, a genuine connection refusal),
  HTTP 500, a nonsense topic, too slow (timeout enforced at 304ms), and disabled by env.
  Layer 1 is *skipped* rather than failed when Python is not running, so it works on a
  fresh clone.
- **Honesty note carried into the code:** the 0.0713 Thompson figure from
  `ml/baselines.py` is **not** this implementation's score — the simulator's version
  builds arms within an episode from whether the estimate moved, this one from stored
  mastery across sessions. Same algorithm, different evidence. Cited as an order of
  magnitude, not as a measurement of this code.
- `npx tsc --noEmit` clean.

---

### Day 2 — Phase 5 step 3: the controller is in the interview loop
- **The division of labour Phase 5 exists to create:** Model 1 decides *what* to ask
  about, the LLM decides *how* to ask it. `answer/route.ts` calls `chooseNextQuestion()`
  before generation and passes the topic into the prompt via two new optional
  `InterviewContext` fields — optional so every provider that ignores them still works.
- **Follow-ups deliberately bypass the controller.** A follow-up is a reaction to what the
  candidate just said; overriding its topic to satisfy a curriculum produces "tell me more
  about that" followed by a hard left turn. The controller resumes on the next *planned*
  question.
- **The prompt pins `question_tags` to the chosen topic.** Left to itself the LLM invents
  tags, `recordAnswer` matches none of them, and the scorecard silently stops updating —
  the controller steering a scorecard its own questions never move. A silent failure, and
  the worst kind.
- **Recent scores are session-scoped; mastery is not.** Morale and the failure streak are
  within-session effects — a bad run last week does not dishearten anyone today — whereas
  mastery is exactly what should carry over.
- `getScorecard()` returns mastery *and* attempts in one query. Read separately, an answer
  landing between the two reads yields numbers describing different moments.
- Migration `009_rl_experience.sql` applied and verified: `scripts/test-rl-experience.ts`
  drives the real logger, **12/12**, including that a closed transition is never
  overwritten and that fallback rows are distinguishable from policy rows.
- **What the table is honestly for, written into the schema comment.** Not online
  learning — fifty real episodes cannot fine-tune a policy, and claiming otherwise is
  something a viva takes apart. It is for checking the simulator against reality (if real
  trajectories look nothing like simulated ones, the central claim rests on a fiction) and
  for attributing behaviour, since `source` records which layer chose.
- **`belief_delta`, not `reward`.** Training rewarded the simulated student's *true*
  mastery gain, which no deployed system can observe. This logs the observable proxy.
  Different quantity, so it gets a different name and can never be silently compared.
- **Loose end closed:** the interviewer prompt's `Known Gap Areas` now comes from the
  parser's `weakestTopics()`. Previously Model 5 seeded the priors while the LLM's
  `recommended_focus_areas` drove the prompt, so the scorecard could start low on
  `ambiguity` while the interviewer was told to probe "distributed systems" — one
  interview pursuing two different notions of the candidate's weakness. The parser wins
  because it speaks the same 15-topic vocabulary as the controller, and because it is the
  one that was *measured* (`scripts/compare-parsers.ts`).
- `npx tsc --noEmit` clean.

---

### Day 2 — Two bugs found by actually using the app
Both were found by the user in the first real session, and neither would have been caught
by any test in the repo — worth noting in the write-up as the limit of unit testing.

- **A typed answer was destroyed by the Back button.** Answers are persisted server-side
  per question, so everything *submitted* was safe; the answer being *typed* lived only in
  React state. Now saved to `localStorage` (debounced 400ms, keyed by session+question),
  restored with a visible "Restored the answer you were writing" notice, and cleared only
  after the server confirms the submission — clearing earlier would open a window where a
  failed request loses the text the mechanism exists to protect. A `beforeunload` handler
  now intercepts Back, refresh and tab-close, which React routing never sees.
- **Exit was destructive by design.** The only way out marked the session `abandoned`. Now
  three choices: keep going, **pause** (leaves the row `in_progress`, so nothing needs
  writing for it to resume), or end. The dashboard surfaces open sessions with a Resume
  card — previously an unfinished interview was invisible and effectively lost.
- **The submit button became unreachable on long answers.** A CSS bug with a real cost: a
  flex child defaults to `min-height:auto` and refuses to shrink below its content, so
  when the variable-height "last answer summary" panel appeared, the column outgrew the
  viewport and pushed the button off-screen with nothing scrollable to reach it. Fixed
  with `min-h-0` on the column, internal scroll on the textarea, `max-h-32` on the summary
  panel, and `shrink-0` on the controls.
- **`createServiceClient` never bypassed RLS.** It was built with `createServerClient` and
  the request's cookie jar, so `@supabase/ssr` found the user's session and sent *their*
  JWT — demoting the service key to an `apikey` header that grants nothing. Every call
  ran as the logged-in user. It surfaced as a storage upload failing with a row-level
  security error on a bucket whose policies were correct; verified by probing that a true
  service-role client uploads fine. It stayed hidden because everywhere else the user was
  permitted anyway. **Consequence to note:** `NEXT_PUBLIC_DEV_BYPASS=true` now genuinely
  bypasses RLS, so the Phase 0 leftover (one run with it `false`) matters more, not less.
- **`next dev` was crashing outright.** Next picks the workspace root by searching upward
  for a lockfile and found a stray `package-lock.json` in the home directory, so it tried
  to watch all of `~` and died on `reading dir "/Users/utkarshgarg/Desktop": Operation not
  permitted`. `turbopack.root` is now pinned in `next.config.ts`.

---

### Day 2 — Score reasoning: the number *is* its justification
- **The problem.** The rubric returned two bare numbers. A candidate scoring 40 had no way
  to know why, and the product could not answer its most obvious question.
- **The design decision that matters.** Asking a model for a score *and* an explanation
  produces two independent outputs that drift — a 40 justified by reasoning that adds to
  75 is routine, and the candidate cannot tell which to believe. So the prompt **no longer
  asks for `star_compliance` or `depth_score` at all.** It asks for an itemised worksheet
  (Situation/Task/Action/Result; Specificity/Metrics/Accuracy/Trade-offs), and
  `lib/ai/reconcile.ts` computes the headline scores by addition. The explanation is not a
  commentary on the score — **it is the score.** They cannot disagree because there is
  only one of them.
- **Every non-zero award requires a verbatim quote** from the candidate's answer. A
  "strong" verdict with no quote is downgraded to "partial" on the way through: an
  unsupported award is the exact failure this rubric exists to prevent.
- `reconcile.ts` also clamps out-of-range points, drops malformed rows rather than
  rendering invented criteria, and **normalises each group by its own maximum** so a model
  returning three rows instead of four does not silently impose a 25% penalty.
- Applied to all four providers (Groq inherits from LMStudio). Falls back to any stated
  scores when no worksheet is returned, so a provider that ignores the new prompt still
  works — the interview never depends on this feature.
- `scripts/test-reconcile.ts` — **13/13**, including the central property: a stated score
  of 95 is overruled by a worksheet summing to 0.
- **Verified against live Groq**, which is what proves the prompt actually works rather
  than merely typechecks:

  | answer | STAR | Depth | sum check |
  |---|---|---|---|
  | vague ("used best practices, made it scalable") | 15 | 15 | matches |
  | specific (p99 1.4s→180ms, N+1 batching, named trade-off) | 70 | 80 | matches |

  The weak answer's rows read "Outcome 0/20 — no evidence — *Quantify the improvement*",
  which is the actionable feedback the feature was for.
- UI: `components/report/ScoreBreakdown.tsx` renders each criterion with its points bar,
  the quote it rests on, and what would have earned the rest. Shown in the report *and*
  live during the interview behind "Why did I score N on depth?", so the coaching lands
  while it is still useful. Renders nothing when a breakdown is absent — an empty scaffold
  would imply the reasoning was withheld rather than never recorded.

---

### Day 2 — Custom JD upload, step 1: the schema
- **Custom JDs live in `job_descriptions`, not a new table.** `sessions.jd_id`, the
  percentile function and the report all join this one table; a second table would mean
  teaching every one of them about two sources of truth. A seeded JD is `user_id IS NULL`,
  a custom one carries its owner. Migration `010_custom_job_descriptions.sql`.
- **A privacy hole had to be closed on the way, not merely avoided.** The existing SELECT
  policy was `USING (TRUE)` — harmless while the table held only sample data, but the
  moment user rows land there it shows everyone everyone else's JDs. It had to be
  *dropped*, not supplemented: Postgres ORs permissive policies together, so adding a
  narrower policy alongside would have left the leak fully open. Now
  `user_id IS NULL OR auth.uid() = user_id`, with insert/update/delete scoped to the owner.
  Seeding is unaffected — the service role bypasses RLS.
- **`company_tier` gained `Other`.** The enum knew four tiers (FAANG, Indian Unicorn,
  Global MNC, Series B Startup). A pasted JD usually fits none, and forcing one would feed
  a false signal into the interviewer prompt, which reads tier.
- Applied and verified against the live database, **6/6**: column present, `Other`
  accepted, custom insert works, **another user's custom JD is hidden from an anon
  reader**, seeded JDs still publicly readable, anon insert refused.

---

### Day 2 — Custom JD upload, step 2: ingestion
- `POST /api/jd/custom` takes a JD three ways — pasted text, an uploaded file
  (PDF / DOCX / plain text), or **a link to a job posting** — and saves it as a row the
  rest of the app cannot distinguish from a seeded one.
- **The URL path is adapted from a collaborator's repo (`CarrerPilot-resume`), and the
  review is written up in `REFERENCES.md`.** The approach was worth taking; the code was
  not run as-is. Reimplemented in TypeScript because the argument that justifies
  `ml/serve.py` as a second process — a torch policy cannot be safely reimplemented — does
  not extend to web scraping. Two things the original lacks were added: a **private-address
  guard** (a server that fetches any URL the user types will read the cloud metadata
  endpoint at 169.254.169.254) and tests.
- **What was deliberately *not* taken, and it is a useful contrast for the write-up:** that
  repo's keyword extractor treats every word over two characters as a skill keyword on top
  of a hardcoded 25-item list. It is the obvious thing to build, and its match-rate is
  dominated by noise — which is the concrete case for Model 5's 15 self-normalised topic
  lexicons.
- **The metadata problem.** A seeded JD arrives with company, role, tier and industry
  filled in; a pasted one is prose. `lib/jd/fields.ts` recovers them, and **validates
  rather than trusts**: `role_type` and `company_tier` are Postgres enums, so a
  hallucinated value is rejected at insert time and surfaces as "failed to save your job
  description" — an unhelpful message for a recoverable problem. Both are coerced to the
  nearest legal value, case-insensitively.
- **The LLM is optional here, as it is in `/api/resume/parse`.** If Groq is down the user
  must still be able to save a JD and interview against it, so `heuristicFields()` reads
  the title, company and seniority from the opening lines with plain string work. It
  returns **"Unknown" rather than a guess** when the JD never names its company — the name
  is spoken aloud by the interviewer in the opening question, so a confident wrong answer
  is worse than an admission. It also returns **no skills at all**, on purpose: guessing
  them by keyword is precisely the noise described above.
- `scripts/test-jd-extract.ts` — **41/41**. Eleven of them are the private-address guard
  (localhost, 127.x, 10.x, 192.168.x, the 172.16–31 range, link-local metadata, `.internal`,
  `.local`, IPv6 loopback, `file://`), including that `172.32.x` is *allowed*, since it is
  outside the private range and blocking it would refuse legitimate links.
- **A real bug the tests caught.** The company-name heuristic matched across a line break,
  so "Senior Backend Engineer at Acme Payments / Bengaluru, India" yielded the company
  "Acme Payments Bengaluru". Job postings put the location on the next line; the line
  break *is* the end of the name. Now matched line by line, and pinned by the test.
- Migration 010's `Other` tier added to the `CompanyTier` type; `extractJDFields` added to
  the `AIProvider` interface and all four providers. `npx tsc --noEmit` clean.

---

### Day 2 — Custom JD upload, step 3: the UI
- `components/jd/CustomJDPanel.tsx` — "Use my own JD" on the practice page, with three
  tabs: paste, upload, job link. **Paste is the default** because it is the only one that
  cannot fail, and every server error message points back to it.
- The link tab says outright that **LinkedIn and Indeed block automated access**, before
  the user tries and fails. A feature that works on two thirds of inputs should say which
  third it does not, at the point of use rather than in an error.
- On save the user goes **straight into the interview brief** rather than back to the grid.
  They pasted a specific job because they want to practise for it now; making them find
  their own card first is a step with no purpose.
- New JDs are held in local state *as well as* being refreshed from the server —
  `router.refresh()` is not synchronous, and a just-saved JD blinking out of the grid
  reads as "it didn't save".
- Own JDs are marked **"Yours"**, sort first in the grid, and can be deleted. Delete is
  optimistic and **puts the card back if the server refuses**, rather than leaving the
  grid disagreeing with the database.
- If the AI was unavailable the toast says so — "company and role were guessed from the
  text" — instead of silently presenting a heuristic guess as an extraction.
- Verified: practice page HTTP 200, `POST /api/jd/custom` returns 401 unauthenticated, and
  **the auth check runs before the URL fetch**, so a logged-out caller can never make the
  server fetch anything. `tsc` and `eslint` clean.

---

### Day 2 — Custom JD, step 4: verified against live Groq
The 41 offline tests only ever exercised the **fallback** path. Whether the model actually
recovers company, role and skills from a real posting was untested — the same distinction
that made the live Groq check worthwhile for score reconciliation.
`scripts/test-jd-fields-live.ts`, **20/20**:

| | result |
|---|---|
| company | **Razorpay**, and tiered as *Indian Unicorn* rather than defaulting to *Other* |
| role / seniority / industry | Senior Backend Engineer · senior · Fintech |
| required skills | Java, Go, Kafka, PostgreSQL, Redis, Kubernetes, AWS |
| nice-to-have | gRPC, fintech, payments — **kept separate**, not merged into required |
| unnamed company | **"Unknown"** — admitted rather than invented |

- **The load-bearing test is the last block, not the extraction.** A custom JD is only
  worth anything if Model 5 can compare it against the resume, because that comparison is
  what seeds the scorecard and steers the controller. A frontend CV against this backend JD
  yields **system-design** as the top gap, 15 priors, all inside the 0.08–0.45 seeding
  band. The pasted JD reaches the models, not just the database.
- Split from the offline tests because it costs API calls and needs a key — same split as
  `scripts/compare-parsers.ts`.
- **Custom JD is now complete: schema, ingestion, UI, and verified extraction.**
  61 tests across the feature (41 offline + 20 live).

---

### Day 2 — Phase 6: the Knowledge Map (Model 2 made visible)
- **The data gap found first.** `knowledge_state` holds one row per (user, topic) and is
  overwritten on every answer, so the current belief was queryable but its *trajectory*
  was not — and "mastery over time" is on the Phase 6 checklist. Two existing sources were
  rejected: replaying `messages` would put a second implementation of the BKT update in the
  read path (the parity tests exist to stop exactly that), and `rl_experience.observation`
  holds mastery only for controller-chosen questions, only since Phase 5, at a column
  offset versioned by `policy`. A user-facing chart should not depend on a feature layout
  that changes when the policy is retrained. Hence migration `011_knowledge_history.sql`,
  an append-only log written beside the upsert that already happens.
- **Not a database trigger**, though one would have been fewer lines: a trigger fires for
  the parser's seeding upsert too, with no access to the score that caused the change —
  and telling a seeded guess apart from earned evidence is the entire point of the `source`
  column. A `parser` row charted as progress shows the candidate improving before they
  answered a single question.
- History writes **degrade rather than throw**, like every other write in `lib/kt/store.ts`.
  Losing a point costs a pixel; an exception would cost the candidate their answer.
- `scripts/test-knowledge-history.ts` — **14/14** against the live database, including:
  re-seeding does *not* log a second time (`ignoreDuplicates` means nothing changed, and a
  row for a non-update draws a step that never happened); the last history point equals
  current mastery **exactly**, so the chart cannot drift from what the controller sees; and
  a real trajectory `0.570 → 0.380 → 0.723` for scores 85, 40, 78 — the bad answer visibly
  pulls mastery down, which is Day 1's graded-evidence work showing up in live data.
- `GET /api/knowledge-map` returns all fifteen topics **always**, in `DEFAULT_TOPICS` order.
  A topic with no row is not missing data — it is a blind spot, and hiding it flatters the
  candidate. It recomputes no BKT; everything is read from what the answer route wrote.
- **Advice is drawn only from *attempted* topics** (when there are at least three).
  Recommending study on the lowest number when that number is an untouched default is
  advice built on nothing.
- `components/knowledge/TopicRadar.tsx` — lifted out of `ReportView`, which now uses it as
  well. The radius axis is **pinned to [0,100]**; recharts would otherwise fit the domain to
  the data and make a candidate at 0.2 across the board look identical to one at 0.9.
- `components/knowledge/KnowledgeMap.tsx` on the dashboard, **above** the per-session
  widgets: everything below that line describes one interview, while this is the only thing
  on the page that persists across all of them. Untouched topics are greyed and labelled
  "not asked", because a default value that looks like a measurement is the most misleading
  thing this panel could show. The trend line refuses to draw with fewer than two days of
  data — one point is not a trend.
- Empty state explains what the map *will* do rather than rendering fifteen identical
  default bars, which would look like a measurement of an unmeasured person.
- `tsc` clean, `eslint` clean on all new files. Dashboard HTTP 200; the API refuses
  unauthenticated callers. (`ReportView` carries 6 pre-existing `any` lint errors —
  confirmed identical before and after this change, so not introduced here.)

---

### Day 2 — Collaboration readiness (found while checking `requirements.txt`)
`ml/requirements.txt` was already fine. The audit it prompted found three real problems,
all of which would have hit the first collaborator to clone the repo:

- **`ml/` had never been committed — zero files tracked.** Every Python module, all ~109
  tests, the trained policies and `requirements.txt` itself existed only on this laptop.
  Not ignored; simply never added.
- **`.gitignore`'s `.env*` also swallowed `.env.example`**, so there was no template of
  which keys the app needs. Fixed with `!.env.example`, verified by `git add --dry-run`
  rather than by `git check-ignore`, which reports negation rules as matches and made the
  first check read as a failure when it was a pass.
- **No Python ignore rules at all.** `git add ml/` would have committed a **1.3GB** venv.
  Now ignored, along with `__pycache__` and the intermediate PPO checkpoint directories
  (~30MB/run, regenerable). **The final policies and `ml/runs/` are committed** — the app
  loads `ppo_v6_seed0.zip` at runtime, and the TensorBoard logs are the record of every
  training run including the failed ones. With those rules, `ml/` is 44 files / 4.0MB.
- **`.env.example` was stale and actively wrong**: it documented
  `GOOGLE_GENERATIVE_AI_API_KEY` while the code reads `GOOGLE_GEMINI_API_KEY`, so anyone
  following it got a Gemini provider with no key and no error. Rewritten against
  `grep -r "process.env." app lib scripts`, and it now covers Groq, the policy service and
  the two dev switches.
- **`README.md` was still `create-next-app` boilerplate.** Replaced with real setup: the
  Python 3.12 constraint and why, that migrations are applied manually in numerical order,
  the `ml/` venv steps, every test command, and the repo's standing traps (DEV_BYPASS
  hiding RLS bugs, MOCK_AI making tracing unverifiable, the two `DEFAULT_TOPICS` lists
  having to stay in sync).

---

## Feature reachability — is it a feature, or just code?

A model with no way to reach it is not a feature. Checked after each piece of work; a
backend with no frontend is *unfinished*, not *done*.

| Feature | Backend | Frontend | Reachable |
|---|---|---|---|
| Interview loop | `api/interview/*` | `InterviewRoom` | ✅ |
| Speech-to-text | `api/interview/transcribe` | mic in `InterviewRoom` | ✅ |
| Score reasoning | `lib/ai/reconcile.ts` | `ScoreBreakdownPanel` (report + live) | ✅ |
| Resume upload/parse | `api/resume/*` | profile page | ✅ |
| Pause / resume | `answer`, `complete` | dashboard Resume card | ✅ |
| Draft recovery | localStorage | `InterviewRoom` | ✅ |
| Speech / filler metrics | `complete` | report | ✅ |
| Custom JD | `api/jd/custom` | `CustomJDPanel` in `JDSelector` | ✅ |
| Scorecard (Model 2) | `api/knowledge-map`, `knowledge_history` | `KnowledgeMap` on dashboard | ✅ |
| **RL controller (Model 1)** | `lib/ai/chooser.ts`, `ml/serve.py` | **none** | ⚠️ |
- **The controller is invisible by design** — it chooses *what* you are asked, so it is
  experienced as better questions rather than as a panel. Worth one cheap surface later
  ("this question targets *ambiguity*, your weakest topic"), because a model that cannot be
  *seen* working is hard to defend in a viva.
- **`app/api/report/[id]/route.ts` has zero callers** — the report page queries Supabase
  directly. Dead code, not a bug; left in place rather than deleted mid-feature.

---

### Day 2 — Single provider, and the resume truncation bug

**Groq is now the only AI provider.** `lib/ai/{gemini,claude,openai,lmstudio}.ts` deleted;
the shared OpenAI-compatible implementation moved into `lib/ai/groq.ts`, which no longer
inherits from anything. `router.ts` is four lines of logic instead of a five-way switch.

Why this was worth doing beyond tidiness: the old router's `default` branch was **Gemini**,
so an unset or misspelled `ACTIVE_AI_PROVIDER` silently ran the whole interview on a
different model — a configuration mistake that produced a working-looking app rather than
an error. `ACTIVE_AI_PROVIDER` no longer exists. `transcribe/route.ts` had the same shape
(fall back to OpenAI if `GROQ_API_KEY` is missing), which turned a missing key into an
OpenAI *charge*; that fallback is gone too.

`generateResumeMarkers` was Gemini-only and outside the `AIProvider` interface. It was
moved into `GroqProvider` rather than deleted with the file — it is the unbuilt "resume
improvement suggestions" feature and the prompt is already written.

**The resume truncation bug.** The interviewer only ever saw the first **1,000 characters**
of the candidate's CV (500 for follow-ups) — roughly the header block and the most recent
role of a one-page CV. Everything below was invisible, so it could not ask about a
candidate's strongest project and could not validate a claim it had never read. Raised to
6,000 / 3,000 (`RESUME_CHARS_QUESTION`, `RESUME_CHARS_FOLLOWUP`), which covers a full
two-page CV. llama-3.3-70b has a 128k context window, so the old number was a guess rather
than a limit.

**Still truncated, same bug, not yet fixed:** the job description, at 800 characters for
questions and 400 for follow-ups. Left alone in this pass to keep one change one change,
but it is the same one-line fix and worth doing before the deploy.

---

### Day 2 — Grading made deterministic, and the collaborator briefs

**Evaluation calls now run at temperature 0** (`GRADING_TEMPERATURE` in `lib/ai/groq.ts`).
They previously used the API default of 1.0, so the same answer submitted twice produced
two different scores. That noise did not stop at the score: BKT consumes it as evidence,
so the mastery estimate inherited it, and the RL controller then chose topics from a number
that moved on its own. Applied to the six calls that *measure* something (evaluation,
resume parse, JD parse, gap matrix, JD fields, resume markers); question and follow-up
generation deliberately stay at the default, because writing should vary and measuring
should not. `transcribe/route.ts` had already pinned temperature 0 — grading was simply
missed.

**Collaboration structure for three additional model-builders.** `ml/contrib/{evaluation,
knowledge_tracing,parser}/`, each with a `BRIEF.md`; `ml/README.md` as the ownership map
and frozen contract; `COLLABORATION.md` for the git workflow.

Design decisions worth recording:

- **Nothing in `ml/` root moves.** A `core/` folder would be tidier, but `serve.py`, every
  test, `test_parity.py` and the generated `lib/parse/lexicon.ts` all resolve these modules
  by their current path. The boundary is documented rather than enforced by directory.
- **Every contributed model runs *beside* the existing one, never in place of it.** The RL
  policy was trained against this specific BKT; substituting the knowledge model does not
  raise an error, it silently invalidates the trained policy. It also preserves the
  baseline, without which no contributor can claim an improvement.
- **All three integrate by the Phase 5 pattern** — FastAPI service, short timeout,
  fallback to the existing implementation. "Kill the service, the app keeps working" is a
  required check in all three briefs, because it is already proven achievable here.
- Each brief names its own honest difficulty rather than burying it: labelling for Model 3,
  data scarcity for Model 2, loss of explainability for Model 5.

Core suite is **120 tests**, not the ~109 quoted in older docs; corrected across README,
`ml/README.md`, `COLLABORATION.md` and the three briefs.

---

## Phases 5 and 6 closed

Both exit criteria passed on live runs: the knowledge map visibly moved after a completed
interview, and killing the policy service mid-interview did not interrupt it. **Phase 7 is
now the only phase not started.**

Four carry-overs remain from earlier phases, tracked here so they are not lost:

| # | Item | Phase | Why it matters |
|---|---|---|---|
| 1 | Run with `NEXT_PUBLIC_DEV_BYPASS=false` | 0 (and 7) | **The important one.** Every live run so far has been with the bypass on, which skips auth *and* makes the DB client bypass row-level security. So no RLS policy has ever been exercised in practice — including the custom-JD privacy fix in migration 010, whose whole purpose is stopping one user reading another's JDs. It is currently believed-correct, not observed-correct. |
| 2 | Write up the Phase 4 RL outcome | 4 | The analysis is already done — `RESEARCH_LOG.md` F9. This is transcription, not derivation. |
| 3 | `PROJECT_CONTEXT.md` says Next.js 14 | 0 | Actually 16.2.9 / React 19.2.4. Cosmetic, but it is a document an examiner may read. |
| 4 | JD still truncated to 800 chars | — | Same bug as the resume truncation fixed above, same one-line fix. Often cuts before the requirements list. |

## Next up

1. **Item 1 above** — one run with the bypass off. It is the only outstanding item that
   could hide a real defect rather than an omission, and it also closes the first line of
   Phase 7.
2. **Phase 7** — harden and deploy (Vercel + a host for `/infer`), plus the write-up.
