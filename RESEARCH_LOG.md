# PrepSense — Research Log

The scientific record, kept for the paper. `PROGRESS.md` is the engineering log
(what was built); this file is the experimental one: what was hypothesised, what was
measured, what failed, and what the results are permitted to claim.

**Rule for this file:** negative results and corrections stay in. A paper whose
experiments all succeeded on the first attempt is a paper that did not measure
carefully, and the failures here are load-bearing — two of them changed the design.

**Reproducibility.** All results: Python 3.12, numpy 2.5.1, gymnasium 1.3.0,
stable-baselines3 2.9.0, torch 2.13.0. Evaluation seeds start at 100 000; training
seeds start at 0. Every number below is reproducible from a stated command.

---

## 1. Research question

> Does a learned curriculum policy select interview questions better than the
> heuristics an adaptive practice tool would otherwise use?

**Contribution claim.** No existing interview-preparation tool uses reinforcement
learning over a persistent knowledge state; surveyed tools are LLM wrappers that
forget between sessions (`REFERENCES.md`). The adaptive-memory architecture —
knowledge tracing persisted per user, feeding a learned question-selection policy —
is the contribution.

**Nearest prior work.** Computerised Adaptive Testing and learning-path
recommendation, not "AI interview coach". `AiFangzhe/Exercise-Recommendation-System`
uses the same architecture (KT model → student simulator → deep RL policy),
independently supporting the approach. `bigdata-ustc/EduSim` and `EduCAT` are design
references; EduCAT supplies stronger baselines than random/weakest-first.

---

## 2. System under study

Five models; two are trained or fitted in any sense.

| # | Component | Method | Learned? |
|---|---|---|---|
| 5 | Resume/JD parser | TF-IDF + spaCy lemmatisation, 15 topic lexicons | No |
| 2 | Knowledge tracing | Bayesian Knowledge Tracing, hand-set parameters | No (swept) |
| 3 | Answer evaluation | LLM rubric (Groq) | No |
| 4 | Speech-to-text | Whisper | No |
| 1 | **Curriculum policy** | **PPO / DQN over a simulated student** | **Yes** |

**Why no dataset.** RL learns by acting, not from labelled examples. PPO needs
10⁴–10⁵ episodes; deployment would yield ~50. Crucially, a fixed log of past
interviews cannot answer the counterfactual the policy needs — what *would* have
happened under a different question — so offline data could not substitute even if it
existed. The student simulator is the data source.

---

## 3. Experimental design

**Metric.** Mean true mastery gain per interview: the change in the simulated
candidate's *hidden* mastery, averaged over topics, over a 20-question episode.

*Not* environment reward, which includes a time cost and a scale factor; comparing on
reward would partly compare our shaping choices rather than the policies.

**Two-level state, and why it is not a simplification.** The candidate has hidden
`true_mastery`; the system holds a BKT estimate built from observed scores through the
identical code path used in production (`lib/kt/store.ts`). *The policy observes only
the estimate.* A policy trained on true mastery would learn from information absent at
inference time. *The reward is computed on true mastery*, so the policy is graded on
what the candidate actually learned, not on what the system convinced itself of — a
policy that games the system's confidence while teaching nothing must score badly.
Tested: `test_reward_tracks_true_learning_not_the_belief`.

**Controls.**
- Evaluation students drawn from seeds ≥ 100 000, disjoint from training.
- Every policy sees the *same* seed sequence → paired comparison.
- Every baseline gets the same difficulty-matching helper, so any advantage of the
  learned policy cannot be an artefact of it alone being able to vary difficulty.
- Paired *t* and Cohen's *d* reported. With n=500 trivial differences reach
  significance, so **d is the number to quote**.

**Baselines.** random (floor); round-robin (≈ a fixed question list, the "before"
condition); weakest-first (**the bar** — what a competent engineer builds in thirty
lines); Thompson sampling (ports `lib/rl/bandit.ts`, already shipping as the app's
fallback chooser); plus two oracles reading hidden state, discussed below.

---

## 4. Experiments

### E1 — Baseline characterisation (environment v1)

`python baselines.py`, 300 episodes.

| policy | gain | ± stderr | topics used |
|---|---|---|---|
| random | 0.0867 | 0.0015 | 11.3 |
| round-robin | 0.1199 | 0.0019 | 15.0 |
| thompson | 0.1246 | 0.0019 | 14.3 |
| weakest-first | 0.1263 | 0.0019 | 15.0 |
| oracle (greedy, hidden state) | 0.1551 | 0.0020 | 9.8 |

**Interpretation at the time:** ordering sensible, ~23% headroom for RL.
**This interpretation was wrong.** See E5.

### E2 — PPO run 1 (300k steps, defaults)

Result: **0.1063**, −14.1% vs weakest-first.

`ep_rew_mean` rose 13.4 → 15.7, which reads as successful training. Behavioural
measurement contradicted it:

| measure | PPO | random | weakest-first |
|---|---|---|---|
| difficulty "easy" | **100%** | 33% | varies |
| mean weakness-rank of chosen topic | **7.0** | 7.0 | 0.0 |

The policy had learned a *state-independent habit*, not a policy.

> **Finding F1.** A rising reward curve is not evidence of learning. Behavioural
> metrics — action distribution, state-dependence of choices — detected a failure the
> reward curve concealed. Worth a paragraph in the paper's methods section.

### E3 — PPO run 2 (1.5M steps, ent_coef 0.02, reward normalisation)

Rationale: exploration had collapsed onto one difficulty; and episode returns are
dominated by the candidate's unobservable learning rate (sampled over a 2.6× range),
so advantage estimates described *which student* more than *which action*.

Result: **0.1108**, −10.5%. Difficulty use improved (69/31 easy/medium); topic rank
stayed ~6.5 — still near-random.

> **Finding F2.** Partial improvement is the trap in RL debugging. The gain from
> 0.1063 to 0.1108 felt like confirmation and pointed away from the real cause.

### E4 — Environment bug, then PPO run 3

Diagnosis by behaviour, not by curve:

| policy | gain | topics covered / 15 |
|---|---|---|
| PPO v2 | 0.1115 | **10.2** |
| round-robin | 0.1195 | 15.0 |
| weakest-first | 0.1261 | 15.0 |

Round-robin has no intelligence whatsoever and beat PPO purely by never repeating.
Cause: attempt counts were normalised by episode length, so "already asked this topic"
registered as **0.05**, beside mastery features swinging by 0.5. Repeating a topic is
the costliest available mistake (gain scales with headroom) and the policy could not
perceive it.

Fix: `min(1, attempts / 3)`. Baselines unaffected (they read only the mastery block),
so the comparison remained valid.

Result: **0.1166**, −5.8%. Coverage 12.9/15, topic rank 4.9 (random = 7.0).

> **Finding F3.** Observation *scaling* silently bounded achievable performance. The
> feature was present and correctly computed; only its dynamic range was wrong.

### E5 — Ceiling analysis (the result that reshaped the study)

Before training further, we measured the **observation-limited ceiling**: the best
policy achievable using only what the agent can see.

| policy | gain | information |
|---|---|---|
| weakest-first | 0.1263 | observation |
| cover-then-weakest | 0.1265 | observation |
| **expected-gain-greedy** | **0.1274** | observation |
| oracle | 0.1551 | **hidden state** |

> **Finding F4 (central).** Environment v1 was nearly saturated by a thirty-line
> greedy heuristic: **~1% headroom**, not 23%. The apparent gap to the oracle was
> almost entirely *information* unavailable to any deployable policy, not *strategy*.
> No amount of training could have closed it.

Methodological point for the paper: **an oracle with privileged information is not a
performance ceiling.** Headroom must be measured against the best policy in the
agent's own information set. Measuring this in Phase 3 would have saved three training
runs; it took four minutes once asked.

At this point the study had two honest options: report the negative result, or extend
the environment. We extended it — with a dynamic justified independently of whether it
helps RL.

### E6 — Morale dynamics (environment v2)

`SimulatedStudent.morale` ∈ [0.25, 1.0], starts 0.75. Falls after poor answers,
recovers after good ones; scales both how well the candidate answers
(`effective_ability = mastery × (0.7 + 0.3·morale)`) and how much they absorb
(`gain ×= morale`). Recovery is slower than decay: confidence is easier to lose.

**Justification.** Self-efficacy and affect effects on learning are established in
education research, and warm-up questions are standard interview practice. The
dynamic was chosen for realism; that it creates room for RL is a consequence, not the
criterion. **This must be stated explicitly in the paper** — adding a dynamic that
happens to favour one's own method is a real threat to validity and is better
disclosed than discovered.

| policy | env v1 | env v2 (morale) |
|---|---|---|
| weakest-first | 0.1263 | 0.0756 |
| **greedy-oracle** (perfect info, greedy) | 0.1551 | **0.0695 — loses** |
| **lookahead-oracle** (perfect info + planning) | — | **0.0808 (+6.9%)** |

> **Finding F5.** With morale, a policy with *perfect knowledge of the candidate*
> scores **below** weakest-first, because chasing maximum immediate learning walks the
> candidate into a run of failures. A planner with identical information gains 6.9%.
>
> **The headroom is now created by sequencing, not by information.** This is the
> strongest available argument for the RL component: it demonstrates that the task is
> not solvable by better estimation alone, which a bandit or a sorted list could
> supply.

`GreedyOraclePolicy` is retained in the baseline table **because it loses** — a row
where the cheating policy underperforms is more informative than one where it wins.

### E7 — PPO run 4 (environment v2, morale)

`train_ppo.py --timesteps 1500000 --ent-coef 0.02 --tag ppo_v4 --seed 0`

| policy | gain | ± stderr | vs weakest | d |
|---|---|---|---|---|
| random | 0.0363 | 0.0006 | −51.9% | −2.74 |
| round-robin | 0.0700 | 0.0009 | −7.2% | −1.06 |
| thompson | 0.0713 | 0.0009 | −5.4% | −0.47 |
| **weakest-first** | **0.0754** | 0.0010 | — | — |
| **ppo-trained** | **0.0737** | 0.0010 | **−2.2%** | **−0.18** |
| greedy-oracle | 0.0698 | 0.0010 | −7.4% | −0.54 |
| lookahead-oracle | 0.0807 | 0.0012 | +7.0% | +0.48 |

Closest yet: −2.2% against −14.1% at run 1, and *d* = −0.18 is a small effect. But
still short, and the training curve tells us why it is not a matter of more compute:
**reward plateaued at ~10.4 by 200k steps and stayed flat for the remaining 1.3M.**
Runs 2 and 3 were still climbing when they stopped; this one had converged and could
not improve. That distinction is diagnostic — a flat curve means the policy has
extracted what it can from its observation, not that it needs longer.

### E8 — Partial observability of morale

Hypothesis: the policy plateaued because it cannot perceive the quantity it is being
asked to manage. Tested by regressing hidden morale on observable features
(300 episodes, weakest-first rollouts).

| features available to the policy | R² on hidden morale |
|---|---|
| mean of last 3 scores *(what it had)* | **0.590** |
| + consecutive-failure count | **0.750** |
| + last-5 mean, session mean | 0.775 |

> **Finding F6.** Morale decays per *consecutive* failure, and a rolling mean cannot
> distinguish "two bad then one good" from "one good then two bad" — sequences that
> leave very different morale. The policy was asked to manage a variable it could
> explain only 59% of.

Fix: observation extended from 32 to 35 features with the consecutive-failure streak,
a 5-answer mean, and a session mean. **All three are computed from the score history
the production app already stores**, so this is a representation change, not extra
information — checked by `test_observation_features_are_all_production_derivable`.
Baselines are unaffected (they read only the mastery block), so the comparison is
preserved.

> **Methodological note.** This is the second time a correctly-computed feature with
> the wrong *representation* bounded achievable performance (see F3, attempt-count
> scaling). Both were invisible in the reward curve and found by asking what the
> policy could actually perceive. For the paper: in partially observed settings,
> quantify observability of the latent variable directly — an R² of 0.59 is a
> measurable diagnosis, not a hunch.

### E9 — PPO run 5 (35-feature observation): **hypothesis refuted**

`train_ppo.py --timesteps 1500000 --ent-coef 0.02 --tag ppo_v5 --seed 0`

Result: **0.0725**, −3.8% — *worse* than run 4's 0.0737, and the training curves
overlap almost exactly (10.34 vs 10.40).

> **F6 is refuted.** Improving morale observability from R² 0.59 → 0.75 produced no
> improvement. The plateau was not caused by the policy's inability to perceive
> morale. Retained in this log because the reasoning was sound and the measurement was
> real — the inference from "the policy cannot see X" to "that is why it underperforms"
> was the error. **Observability is necessary, not sufficient.**

Worse, behavioural measurement showed a *regression* to the run-1 failure mode:

| measure | run 3 | run 4 | run 5 |
|---|---|---|---|
| difficulty "easy" | 79% | — | **100%** |
| weakness-rank (0 = weakest-first, 7 = random) | 4.9 | — | **7.5** |
| topics covered / 15 | 12.9 | — | **9.4** |

Enlarging the observation from 32 to 35 features made exploration *harder*, not easier.

> **Finding F7 (the pattern across all five runs).** Every from-scratch PPO run
> converged to a **state-independent habit** — a fixed difficulty and near-random topic
> choice — rather than to a policy. None discovered even the thirty-line weakest-first
> heuristic, across 300k–1.5M steps, three observation designs and two environments.
>
> Diagnosis: per-action reward is small and noisy relative to between-student variance
> (learning rate alone varies 2.6× and is unobservable), so the advantage estimate
> rarely favours "sort by the first fifteen features" long enough to reinforce it.
> **This is an exploration and credit-assignment failure, not a capacity or compute
> failure** — and five runs of tuning did not fix it, which is itself the evidence.

### E10 — Behavioural cloning warm start

*Pending.* The standard remedy is to stop requiring the agent to rediscover known-good
behaviour: fit the policy network to an expert by supervised learning, then fine-tune
with PPO from there.

Two experts, and the distinction matters for the claim:

* **weakest-first** (observation-only). Cloning can at best reproduce it; any
  improvement must come from PPO. Conservative, easiest to defend.
* **lookahead-oracle** (reads hidden state). This is **privileged-expert
  distillation**, standard in robotics teacher-student training. The student sees only
  the observation at every stage — *only the teacher's choices are transferred*, never
  its inputs — so nothing leaks into deployment. This directly tests the open question
  from E5/E8: **is the planner's advantage reachable from the observation alone?**

**Result.** Both experts cloned with identical machinery, 4 000 episodes / 80 000
decisions, 30 epochs, held-out validation split.

| teacher | information | val action-match | final loss | clone's gain |
|---|---|---|---|---|
| lookahead-oracle | **hidden state** | 23.5% | 2.43 | **0.0468** |
| weakest-first | observation only | **90.6%** | 0.27 | **0.0793** |

The second row is the control, and it is what makes the first interpretable: the same
code reproduces an observation-only expert to within noise of its teacher (0.0793 vs
0.0789). The lookahead clone therefore did **not** fail through undertraining or a bug.

> **Finding F8 (central, and the strongest result in the study).** The planning
> oracle's advantage is **not recoverable from the observation**. Its policy is not a
> function of what a deployed system can see: it faces observationally identical states
> and correctly chooses differently, because it knows the candidate's hidden mastery and
> morale. A student restricted to the observation can only fit the *average* of those
> incompatible choices — and that average scores **0.0468, below both the teacher
> (0.0847) and the simple heuristic (0.0789)**.
>
> This is the documented failure mode of imitating privileged experts (cf. staged
> training in *Learning by Cheating*), and it is measured here rather than assumed:
> 23.5% action-match with loss plateauing near 2.43, against 90.6% and 0.27 for an
> observation-only teacher of identical action-space size.

**What this settles.** E5 asked how much headroom exists; E8 asked whether the policy
could perceive morale; F8 answers the underlying question both were circling. The 7%
gap between `lookahead-oracle` and `weakest-first` is **an information gap, not a
strategy gap** — the same error as E1/F4, now demonstrated by construction rather than
by argument. Three independent lines of evidence agree:

1. No hand-written observation-only heuristic beat weakest-first (E5, and the morale
   threshold sweep in E6).
2. Five from-scratch PPO runs converged below it (F7).
3. Direct distillation of the planner collapses to 0.0468, while distillation of an
   observation-only expert succeeds at 90.6% match (F8).

**Consequence for the claim.** The honest position is that under this environment and
observation, weakest-first is at or very near the achievable ceiling. Any remaining
contribution from a learned policy must be small. **This is a bounded negative result
with a constructive explanation**, which is materially stronger than "our method did not
beat the baseline": it identifies *why*, and predicts what would change it — a richer
observation (longer score history, response latency, explicit confidence signals), all
of which the deployed app could actually collect.

### E11 — PPO fine-tuned from the weakest-first clone

`pretrain_bc.py --expert weakest` → `train_ppo.py --resume ... --timesteps 1000000`

| policy | gain | ± stderr | vs weakest | t | d |
|---|---|---|---|---|---|
| random | 0.0363 | 0.0006 | −51.9% | −61.3 | −2.74 |
| round-robin | 0.0700 | 0.0009 | −7.2% | −23.6 | −1.06 |
| thompson | 0.0713 | 0.0009 | −5.4% | −10.4 | −0.47 |
| **weakest-first** | **0.0754** | 0.0010 | — | — | — |
| **ppo (BC + fine-tune)** | **0.0750** | 0.0010 | **−0.5%** | **−1.1** | **−0.05** |
| greedy-oracle | 0.0698 | 0.0010 | −7.4% | −12.2 | −0.54 |
| lookahead-oracle | 0.0807 | 0.0012 | +7.0% | +10.8 | +0.48 |

Starting *at* the baseline rather than below it, PPO **held** it and found no
improvement: *d* = −0.05, *t* = −1.1. On 500 paired episodes this is statistical
equivalence, not a loss — the two policies are indistinguishable.

> **Finding F9 (the study's conclusion).** With this observation and this environment,
> **weakest-first is at the achievable ceiling.** Reinforcement learning neither
> improves on it nor, once warm-started, degrades it.

**Why this is a conclusion and not a fifth failed run.** F7 left open whether PPO's
underperformance was an exploration artefact. E11 removes that confound by
construction: the policy begins at baseline behaviour, so any available improvement
would only need to be *found from there*, not discovered from scratch. It was not.

Four independent lines of evidence now agree:

1. No hand-written observation-only heuristic beats weakest-first (E5, E6).
2. Five from-scratch PPO runs converge below it (F7).
3. Distilling the planning oracle collapses to 0.0468, while distilling an
   observation-only expert succeeds at 90.6% action-match (F8).
4. PPO warm-started at the baseline cannot improve on it (E11).

Each could individually be explained away as a tuning failure. Together they are a
consistent account: **the 7% gap to the planning oracle is an information gap.**

**Reported claim.** *"A learned curriculum policy matches, but does not exceed, a
weakest-first heuristic (d = −0.05, n = 500 paired episodes). Analysis attributes this
to partial observability rather than to optimisation: a planning oracle with access to
latent mastery and morale achieves +7.0%, but its policy is not a function of the
observable state and cannot be distilled into an observation-limited student."*

**What the analysis predicts would change it.** Enrich the observation with signals a
deployed system can collect but this one omits — full score history rather than
summary statistics, response latency (already persisted as
`messages.time_taken_seconds`), self-reported confidence, and answer-length dynamics.
F8 gives a cheap test for any such extension *before* retraining: re-run the
distillation and see whether the planner becomes imitable.

---

## 5. Threats to validity

Stated plainly; each belongs in the paper.

1. **The student model is an assumption, not a measurement.** No human data
   calibrates BKT's four parameters, the ZPD width, or the morale constants.
   Mitigation: `sensitivity.py` sweeps them and reports the range over which any
   advantage holds. The claim is bounded to "against a BKT student model with morale
   dynamics", never "teaches real people better".
2. **Morale was added after observing that v1 offered no headroom.** Independently
   motivated, but the sequence matters and is disclosed above.
3. **Topics are modelled as independent.** Real skills correlate; modelling that needs
   data we do not have.
4. **No forgetting within an episode.** Episodes are one interview, so decay over
   weeks never arises — but the persistent scorecard spans sessions, where it would.
5. **Difficulty has three fixed levels**, matching what the question generator can
   actually execute, not a fitted per-item parameter.
6. **Simulation-to-reality gap is unmeasured.** The app records real mastery
   trajectories in `knowledge_state`; even a handful of real interviews compared
   against simulated ones would be a meaningful validity check.

---

## 6. Results the project can honestly claim

- Model 5 (classical parser) matches an LLM parser on topic identification at ~1/150th
  the latency and no cost, with **no topic found by the LLM that it missed** (n=3
  fixtures). Quote as "no disagreement", not "identical ranking": the LLM names 2–3
  mappable topics, so agreement is 100% of its output but 40–60% of the classical
  top-5.
- Bayesian knowledge tracing persists across sessions and moves as expected under
  graded evidence, verified against the production database (13/13 checks).
- Python and TypeScript implementations of BKT agree to **1e-12** across a parameter ×
  mastery grid and over multi-step trajectories.
- **Curriculum policy: matches but does not exceed weakest-first** (0.0750 vs 0.0754,
  *d* = −0.05, n = 500 paired). Reported as equivalence.
- **The gap to a planning oracle (+7.0%) is an information gap, not a strategy gap** —
  established by construction in F8, not by argument.

---

## 7. Design decisions with a defensible rationale

Each is a likely question in review or viva.

- **`p_guess = 0.08`** (vs ~0.25 typical): an open-ended interview answer cannot be
  guessed into a good rubric score the way a multiple-choice item can.
- **Graded evidence over a pass/fail threshold.** A hard cutoff at 60 made a 61 and a
  99 identical, saturating mastery in two questions (0.08 → 0.94) and flattening the
  very signal the policy consumes. `observation_confidence` maps score through a
  logistic centred on the pass mark; at confidence 1 or 0 it reduces *exactly* to the
  old update, so the two are one swept parameter rather than rival models.
- **Mastery observation is `depth_score` only.** `star_compliance` measures adherence
  to the STAR *format*; a correct system-design answer has no "Situation" or "Result"
  and would score as ignorance.
- **PPO primary, DQN comparative.** 45 discrete actions on a 20-step horizon: PPO is
  far less hyperparameter-sensitive, and DQN's replay buffer retains early bad-policy
  transitions for a long time when episodes are short. If DQN loses, that is a
  reportable result.
- **A multi-tagged question updates every tagged topic from one outcome.** Textbook
  BKT assumes one skill per item; splitting credit needs a multi-skill model and data
  to fit it.

---

## 8. Engineering findings worth a footnote

- **`mastery REAL` quantised BKT posteriors.** Single precision (~7 digits) turned
  0.414038818359375 into 0.414039 on every write. Caught only because a test asserted
  untouched topics stay *exactly* untouched; a 1e-6 tolerance would have passed while
  state drifted from the model the policy trains against, compounding per answer.
- **An error message naming a cause is a hypothesis, not a diagnosis.** torch reported
  "high likelihood that your checkpoint file is corrupted"; `zipfile.testzip()` found
  the archive clean and every tensor loaded once buffered. The real cause was an
  SB3/torch interface change. Following the message would have meant discarding a
  valid 300k-step model.
- **A statistical error of my own:** an early test compared *independent* standard
  errors for two policies run on *identical* students, making a real effect look like
  noise. Corrected to the paired test used throughout.

---

## 9. Suggested paper structure

| Section | Source |
|---|---|
| Introduction / motivation | §1, `REFERENCES.md` |
| Related work | `REFERENCES.md` (CAT, learning-path recommendation, EduSim/EduCAT) |
| System architecture | §2, `BUILD_PLAN.md` |
| Student model & environment | §3, `ml/student_sim.py` docstring |
| Experimental setup | §3 (controls, metric, baselines) |
| Results | §4 (E1–E7), `results.png` |
| **Negative results & environment design** | §4 E2–E5 — F1–F4 |
| Sensitivity analysis | `sensitivity.py` output |
| Threats to validity | §5 |
| Conclusion & future work | §5.6 (real-user validation) |

The negative-results section is not padding. F1 (reward curves mislead), F3
(observation scaling bounds performance) and F4 (privileged-information oracles are
not ceilings) are transferable methodological points, and F4 in particular is a
mistake the cited prior work does not warn about.
