# PrepSense — Prior Work & References

What already exists for the two models being built, what to reuse, and what not to.
Searched 2026-07-31.

---

## The key realisation

This problem has an established research name. Searching "AI interview coach" finds only
LLM wrappers. The relevant literature is:

- **Computerized Adaptive Testing (CAT)** — pick the next question to *measure ability*
  accurately in the fewest questions.
- **Learning path / exercise recommendation** — pick the next question to *maximise
  learning*.

**PrepSense is the second one.** Our reward is mastery gain, not measurement precision.
This distinction decides which prior work applies, and it is worth stating explicitly in
the write-up.

---

## Directly relevant — same architecture as ours

### [AiFangzhe/Exercise-Recommendation-System](https://github.com/AiFangzhe/Exercise-Recommendation-System)
> "We build a student simulator with our concept-aware deep knowledge tracing model, and
> then use it to train a flexible and scalable personalized exercise recommendation policy
> with deep reinforcement learning."

This is **exactly the plan in `BUILD_PLAN.md` §3** — knowledge-tracing model becomes a
student simulator, RL policy trains against it, objective is maximising knowledge level.
Independent confirmation that the approach is sound and not invented here.

**Use as:** design reference for Phases 3–4. They use DKT where we use BKT — simpler, and
justifiable since we have no data to train a deep model on.

### [bigdata-ustc/EduSim](https://github.com/bigdata-ustc/EduSim) · MIT
Platform for building gym-style education simulation environments. Three environment
families (pattern-based, data-driven, hybrid) and three pre-built envs (TMS-v1, MBS-v0,
KSS-v2). TensorBoard integration.

**Use as:** reference for Phase 3's environment design — reward shaping, episode
termination, state representation. **Do not adopt wholesale**: our action space is our own
15-topic taxonomy, and a dependency here would couple our env to their learner models.

---

## Relevant but a different objective

### [bigdata-ustc/EduCAT](https://github.com/bigdata-ustc/EduCAT) · MIT
The CAT library. Implements **NCAT** (Neural CAT) and **BOBCAT** — both RL-based item
selection — plus classical baselines: Maximum Fisher Information (MFI), Kullback-Leibler
Information (KLI), MAAT, BECAT. Student models: IRT, MIRT, Neural Cognitive Diagnosis.

**Caveat:** CAT optimises *measurement accuracy*, not learning. Its objective function is
not ours, so its selection strategies are not drop-in.

**Use as:** (a) proof that RL-based question selection is established practice, and (b) a
source of **stronger baselines**. Beating random and weakest-first is a low bar; MFI is a
real algorithm and beating it is a much better result. Consider adding one classical CAT
baseline in Phase 4 if time allows.

### [Survey of Computerized Adaptive Testing: A Machine Learning Perspective](https://arxiv.org/html/2404.00712v1)
The literature review, already written. Primary citation for the write-up's related-work
section.

---

## For validating our BKT

### [CAHLR/pyBKT](https://github.com/CAHLR/pyBKT) · MIT
Berkeley's BKT implementation. Fits parameters from data, "Roster" feature for simulating
cohorts, supports KT-IDEM / forget-rate / multi-learn variants. C++ backend, 70–130×
faster fitting.

**Do not replace `ml/bkt.py` with it.** Three reasons:
1. It is built for *fitting BKT to datasets* — which we cut from scope.
2. Its API is dataframe-oriented; our RL inner loop needs a fast scalar per-step update
   over millions of steps.
3. We must port the maths to TypeScript. A 40-line function ports; a C++ library does not.

**Do use it as a correctness check** — run identical parameters through both and confirm
our `update()` matches. Cheap, and a citable validation step for the write-up.

---

## What does NOT exist

Searched thoroughly for AI interview coaches using RL question selection or persistent
knowledge tracing. Found many: voice-based coaches, multi-agent LLM interviewers,
JD/resume analysers, hackathon projects. **All are LLM wrappers** — ask, score, report,
forget. None maintain learner state across sessions; none use RL to sequence questions.

**Implication:** the adaptive-memory angle is genuinely the contribution, and that is a
fair claim to make. It also means there is no reference implementation to copy for the
interview domain — the education-domain repos above are the closest analogues, and
adapting them to interviews is our own work.

---

---

# Round 2 — systematic search by model

## 🔴 Bug found: the filler-word metric measures nothing

`lib/scoring/index.ts:118` computes `computeFillerRate(allAnswers)` over the transcript;
`complete/route.ts:89` stores it in `speech_feedback`, and the report displays it.

**Whisper removes disfluencies.** It is trained to produce clean, readable transcripts, so
"um", "uh" and false starts are silently dropped before the text ever reaches
`countFillerWords`. Voice answers will therefore report a near-zero filler rate regardless
of how the candidate actually spoke. Typed answers contain no fillers either. So the
metric reads ~0 for everyone and the report shows confident, meaningless feedback.

**Options:**
1. **[CrisperWhisper](https://github.com/nyrahealth/CrisperWhisper)** — verbatim ASR built
   specifically for this: word-level timestamps plus filler/repetition/cut-off detection,
   tops the disfluency-F1 benchmark. Self-hosted, so it costs deployment complexity.
2. Drop delivery metrics from the report until voice fidelity is solved. Honest, free.
3. Keep it, but only score filler rate on voice answers and label it as approximate.

**Recommendation: option 2 now, option 1 only if voice becomes a headline feature.** Do not
leave a metric in the report that is structurally incapable of being correct.

## Model 1 (RL) — [MaskablePPO / sb3-contrib](https://sb3-contrib.readthedocs.io/en/master/modules/ppo_mask.html)
Action masking for discrete spaces: the policy is prevented from choosing invalid actions
rather than being punished for them afterwards.

**Directly useful.** Our 45 actions are not always all legal — a topic with no remaining
questions, or one already asked this session, should be masked out. Without masking, PPO
wastes capacity learning to avoid actions we could simply forbid.

Note the known issue with *large* action spaces (errors surfacing after 100k+ timesteps).
At 45 actions we are far below that. Use `MaskableEvalCallback` and the maskable
`evaluate_policy`, not the base SB3 versions — a silent evaluation bug otherwise.

## Model 5 (Parser) — [esco-skill-extractor](https://github.com/KonstantinosPetrakis/esco-skill-extractor)
Extracts ESCO skills and ISCO occupations from CVs and job descriptions — the EU standard
skill taxonomy, thousands of skills with defined relationships.

**Verdict: do not adopt as the action space.** Our 15 topics are the RL action space, and
it must stay small — thousands of ESCO skills would make the policy untrainable. But ESCO
is a good *intermediate* layer: extract ESCO skills, then map them onto the 15 topics.
That is a more defensible taxonomy than my hand-written keyword lists.

**Stretch goal for Phase 1**, only if the basic TF-IDF parser lands early.

## Model 3 (Evaluation) — [Autorubric](https://arxiv.org/html/2603.00077v1) and LLM-judge bias
Rubric-based LLM evaluation frameworks exist, with documented mitigations for **verbosity
bias** (judges prefer longer answers), position bias, and criterion conflation.

**Why this matters here specifically:** the rubric score feeds BKT, which feeds the RL
reward. If the judge simply rewards longer answers, the policy learns to steer toward
topics that elicit long answers — a reward hack laundered through two models. Note that
`lib/scoring/index.ts` already has `computeConciseness`, which partially counteracts this.

**Cheap mitigation:** score each rubric dimension in a separate call rather than one blob,
and spot-check a handful of scored answers by hand. QWK is the standard agreement metric
if you ever want to quantify it.

## Whole project — [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) · ✨ feature idea
FSRS, the modern spaced-repetition algorithm (difficulty / stability / retrievability),
MIT, `pip install fsrs`, with a JavaScript port so it works on both sides.

**This fills a real gap.** BKT models *learning* but not *forgetting* — mastery only ever
goes up. A candidate who nailed system design two months ago is not still sharp on it.
FSRS gives a principled decay and, more usefully, a **"revisit this topic on date X"**
signal — which is exactly the retention hook a prep app needs.

Two ways in: as a feature (dashboard tells users what to review today), or as a modelling
improvement (feed retrievability into the RL state so the policy learns to revisit).

**Recommendation: Phase 6 stretch.** Do not add it before the core loop works — BKT
supports a forget-rate parameter that covers the modelling need more cheaply. But it is the
single best *product* idea found in this search.

## Interview question banks — nothing worth using
`awesome-behavioral-interviews`, `interview-handbook-2026` and similar are markdown study
guides, not structured data. No difficulty labels, no topic tags, no JSON.

**Not a problem:** our chooser outputs `(topic, difficulty)` and the LLM writes the question
text. We never needed a question bank. Worth stating explicitly, since the diagram mentions
"question bank resolution" — that requirement is satisfied by generation instead.

---

## Code reused / adapted

**`pragati281105/CarrerPilot-resume`** — a FastAPI resume/JD ATS-matching backend
(collaborator's repo; reuse permitted directly). Reviewed in full before adopting
anything.

- **Adopted:** the URL-to-job-description approach in `backend/utils/jd_parser.py` —
  browser User-Agent to avoid 403s, prefer a `<main>` / `<article>` / `job-description`
  container, require the candidate to have real content before accepting it, fall back to
  the whole page, then normalise whitespace. **Reimplemented in TypeScript**
  (`lib/jd/extract.ts`) rather than run as a service: the reasoning that justifies
  `ml/serve.py` as a second process is that a torch policy cannot be safely reimplemented,
  and web scraping plainly can. Two things were added that the original does not have: a
  private-address guard (server-side fetching of a user-supplied URL is an SSRF hole once
  deployed) and tests.
- **Not adopted, and why it matters for the write-up:** its `keyword_extractor.py`
  compares documents by treating *every* word over two characters as a keyword, plus a
  hardcoded 25-item skill list. That produces a match-rate dominated by noise. This is the
  concrete illustration of why Model 5's 15 topic lexicons with self-normalised TF-IDF are
  worth the extra work — the naive version is the obvious thing to build and it does not
  survive contact with a real JD.
- **Not adopted:** its ATS similarity score, which asks an LLM for a bare number 0–100
  with no rubric. That is exactly the un-evidenced scoring the Day 2 score-reconciliation
  work removed from this project.
- **Not adopted:** its resume field extraction — it does not extract company name, role
  title or seniority at all, which was the one gap the pasted-JD path actually needed
  filling.

---

## Actions taken from this research

**Adopt:**
- [ ] Phase 4: use **MaskablePPO** (`sb3-contrib`) instead of plain PPO — mask illegal
      actions. Use `MaskableEvalCallback`, not base SB3 evaluation.
- [ ] Phase 4: add **MFI** (from EduCAT) as a stronger baseline than weakest-first
- [ ] Phase 3: read **EduSim**'s env design before finalising the reward function
- [ ] Phase 2/4: validate `ml/bkt.py` against **pyBKT** on identical parameters
- [ ] Phase 0/6: **decide the filler-metric fix** — currently reports meaningless numbers
- [ ] Phase 4: score rubric dimensions in separate calls to limit verbosity bias leaking
      into the RL reward

**Stretch, only if ahead of schedule:**
- [ ] Phase 1: ESCO skill extraction as an intermediate layer above the 15 topics
- [ ] Phase 6: **FSRS** for forgetting + "revisit today" recommendations

**Write-up:**
- [ ] Cite the CAT survey; state the testing-vs-teaching objective distinction
- [ ] Note that no existing interview coach uses RL or persistent knowledge tracing
- [ ] Justify BKT over DKT (no data to train a deep model on)
