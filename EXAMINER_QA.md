# Examiner / Reviewer Question Bank

Anticipated questions with honest answers. Updated as the project develops.

**How to use this.** The hostile questions are the valuable ones, so they come first.
Every answer here is one you can defend with a number or a file reference — if an
answer ever stops being true, fix the answer rather than the phrasing.

**Three rules for the viva itself.**
1. If you do not know, say so, then say how you would find out. Inventing a number is
   the only unrecoverable mistake.
2. State limitations before you are asked. Volunteering them reads as rigour;
   conceding them reads as damage control.
3. Quote effect sizes, not just significance. With n=500 nearly anything is
   "significant".

---

## A. The hostile questions

### A1. "Isn't this just a wrapper around an LLM?"

No, and the architecture makes the distinction concrete. Every surveyed competitor is
stateless — it forgets you between sessions. PrepSense persists a per-topic mastery
estimate in `knowledge_state`, updated by Bayesian Knowledge Tracing after every
answer, and a learned policy selects the next question from that state.

**Verifiable claim:** seed leadership at 0.080, answer well twice, and a *fresh
session with no conversation context* reads 0.941. Verified against the live database,
13/13 checks (`scripts/test-knowledge-state.ts`).

The LLM does two jobs only: scoring an answer against a rubric, and writing question
text. It chooses nothing.

### A2. "You added morale only after discovering RL had no advantage. Isn't that fitting the environment to your method?"

**The sequence is exactly as you describe, and it is disclosed in §5.2 of the research
log rather than hidden.** Three points in defence:

1. **The dynamic is independently justified.** Self-efficacy and affect effects on
   learning are established in education research, and warm-up questions are standard
   interview practice for precisely this reason. It was not invented to create
   headroom.
2. **It was not tuned until RL won.** It has been added once, with hand-set
   parameters, and swept in `sensitivity.py`. The policy had not been retrained when
   the parameters were fixed.
3. **The alternative was reported too.** Environment v1's result — a greedy heuristic
   within 1% of the observation-limited ceiling — is in the paper as finding F4, not
   deleted.

**The honest framing:** v1 tested whether curriculum sequencing helps when learning
depends only on topic and difficulty. It does not. That is a real negative result.
Morale tests a different, better-motivated question, and the paper reports both.

### A3. "Your student model is made up. Why should I believe any of this?"

You should not believe it as a claim about human candidates, and the paper does not
make that claim. The result is bounded: *"against a BKT student model with morale
dynamics, the policy achieves X."*

What makes it more than arbitrary:
- BKT is a standard, widely-used knowledge-tracing model, not something invented here.
- Answer generation uses a 2-parameter IRT model, standard in psychometrics.
- `sensitivity.py` sweeps every hand-set parameter and reports the range over which the
  advantage holds. **If the result depended on one lucky setting, that sweep exposes it.**

**Path to a stronger claim:** the deployed app records real mastery trajectories.
Comparing even a handful against simulated ones is stated as future work (§5.6).

### A4. "Why is there no dataset? Isn't that a red flag?"

RL learns by acting, not from labelled examples. Three reasons a dataset is not merely
absent but unusable here:

1. **Volume.** PPO needs 10⁴–10⁵ episodes; deployment yields ~50.
2. **Counterfactuals.** A log of past interviews records what happened, never what
   *would* have happened had a different question been asked. That counterfactual is
   exactly what the policy must learn.
3. **Ethics.** The policy must ask bad questions to learn they are bad. Not acceptable
   on real users.

This is standard: EduSim, EduCAT and the exercise-recommendation literature all train
against simulated learners.

### A5. "PPO didn't beat the baseline. Hasn't your project failed?"

**Be precise: it did not lose — it tied.** 0.0750 vs 0.0754, *d* = −0.05, *t* = −1.1
over 500 paired episodes. That is statistical equivalence, and calling it a loss
misreports it.

The contribution is the *explanation*, which is established by construction rather than
asserted. Four independent lines of evidence agree that the observation, not the
optimiser, is the binding constraint:

1. No hand-written observation-only heuristic beats weakest-first.
2. Five from-scratch PPO runs converge below it.
3. **Distilling the planning oracle collapses to 0.0468** — while distilling an
   observation-only expert with identical machinery reaches 90.6% action-match and
   matches its teacher. The planner's policy is *not a function of the observable
   state*.
4. PPO warm-started at baseline behaviour cannot improve on it.

Any one alone could be dismissed as a tuning failure. Together they identify the cause:
**the 7% gap to the oracle is an information gap, not a strategy gap.**

The analysis also predicts what would change it — richer observations (full score
history, response latency, confidence signals) — and F8 supplies a cheap test for any
such extension *before* committing to retraining. A negative result that explains
itself and tells you what to do next is a contribution; one that merely reports a
number is not.

### A5b. "Isn't the honest conclusion that your architecture is unnecessary?"

For the *curriculum policy*, on this observation: yes, and the paper says so. That is
finding F9.

Note carefully what this does **not** undermine. The persistent scorecard is what
weakest-first itself runs on — the winning policy is still adaptive and still requires
knowledge tracing across sessions. The negative result is about the *learned* chooser
specifically, not about the adaptive-memory architecture, which every non-trivial
policy in the comparison depends on.

### A6. "Your baselines are weak. Anyone can beat random."

Agreed, which is why random is labelled the floor and not a competitor. **The bar is
weakest-first** — what a competent engineer builds in thirty lines. Also included:
round-robin (the "before" condition, ≈ a fixed question list), Thompson sampling
(which *already ships* in the app as the fallback chooser), and two oracles reading
hidden state.

Every baseline receives the same difficulty-matching helper, so no advantage of the
learned policy can come from it alone being able to vary difficulty
(`baselines.py:_difficulty_for`).

### A7. "How do I know the policy isn't just memorising your simulated students?"

- A fresh candidate is sampled every episode: mastery from Beta(2,3), plus learning
  rate, ZPD width, score noise, discrimination and morale parameters all drawn per
  episode.
- Evaluation uses seeds ≥ 100 000, disjoint from training seeds.
- `test_sampled_students_differ` asserts the population actually varies.

---

## B. Method

### B1. "Why BKT rather than Deep Knowledge Tracing?"

Three reasons. **Interpretability:** BKT's state is a probability per topic that can be
shown to the user as a scorecard; DKT's hidden state cannot. **Data:** DKT needs large
interaction datasets; we have none. **Generativity:** BKT can *simulate* a student,
which is what makes offline RL training possible — a discriminative model could not.

Cost, stated openly: BKT assumes one skill per item and no forgetting.

### B2. "Your BKT parameters are not fitted. Isn't that fatal?"

They are hand-set with stated reasoning — notably `p_guess = 0.08` versus the ~0.25
typical of multiple-choice, because an open-ended interview answer cannot be guessed
into a good rubric score.

Defensibility comes from **sensitivity analysis, not fitting**: `sensitivity.py`
sweeps `p_learn`, `p_slip`, `p_guess` and the evidence softness, and reports whether
the advantage survives. Fitting to a maths-tutoring dataset would import assumptions
from a domain with very different guess dynamics — worse, not better.

### B3. "Why does the policy see the BKT estimate rather than true mastery?"

Because true mastery does not exist at inference time. A policy trained on it would
learn from information it will never have and collapse in production.

The reward, conversely, *is* computed on true mastery, so the policy is graded on real
learning rather than on the system's self-confidence. Without that split, a policy
could learn to manipulate the app's belief while teaching nothing, and every dashboard
would report success. Tested:
`test_reward_tracks_true_learning_not_the_belief`.

### B4. "Why PPO rather than DQN?"

45 discrete actions on a 20-step horizon. PPO is markedly less
hyperparameter-sensitive, and DQN's replay buffer retains early bad-policy transitions
for a long time when episodes are this short. DQN is implemented and reported as a
comparison, because "we ran both and PPO won, for these reasons" is a stronger claim
than only reporting the method that worked.

### B5. "Why 20 questions and 15 topics?"

20 matches a realistic interview length. The 15 topics come from `DEFAULT_TAGS`, which
already existed in the product. Note the tension, stated honestly: 20 questions across
15 topics makes *coverage* a dominant strategy, which is why round-robin performs
respectably. A longer episode would reward sequencing more and is a fair criticism.

### B6. "Why graded evidence instead of a pass/fail threshold?"

The threshold discarded most of what the rubric measured — a 61 and a 99 were
identical observations, as were a 59 and a 12. Consequence: mastery saturated after
two questions (0.08 → 0.94, reaching 1.000 by the fourth), flattening the exact signal
the curriculum policy consumes.

`observation_confidence` maps the score through a logistic centred on the pass mark.
**At confidence 1 or 0 it reduces exactly to the old update** (pinned by a test), so
the two are a single swept parameter rather than rival models.

---

## C. Results and statistics

### C1. "Is your improvement statistically significant?"

Reported as a paired *t* and Cohen's *d*. Paired because every policy runs on the same
students (same seed sequence), so between-student variance cancels.

**Quote *d*.** With n=500, differences far too small to matter reach significance.
This distinction cost a corrected test in development: an early version compared
*independent* standard errors for policies run on *identical* students, making a real
effect look like noise (§8 of the research log).

### C2. "Why report mastery gain rather than reward?"

Reward contains a time cost and a scale factor that we chose. Comparing policies on it
would partly compare our reward shaping rather than their behaviour. Mastery gain is
the outcome the system exists to produce.

### C3. "Your oracle scores below a simple heuristic. Is that a bug?"

No — it is the central finding, F5. `greedy-oracle` has perfect knowledge of the
candidate but chooses greedily, so it chases maximum immediate learning into a run of
failures and collapses morale. `lookahead-oracle`, with *identical* information but
planning, scores ~7% above weakest-first.

**The headroom therefore comes from sequencing, not from information** — which is the
argument for the RL component. A bandit or a better estimator cannot supply it. The
greedy oracle is retained in the results table precisely because it loses.

### C4. "How much headroom is there really?"

Measured, not assumed — and getting this wrong was the study's largest error. In
environment v1 the gap to the oracle looked like 23%, but the best policy limited to
the *observation* scored 0.1274 against weakest-first's 0.1263: **1%**. The rest was
information no deployable policy could have.

**General lesson (F4): an oracle with privileged information is not a performance
ceiling.** Headroom must be measured within the agent's information set.

---

## D. Implementation

### D1. "You have BKT in Python and TypeScript. How do you know they agree?"

`ml/test_bkt_parity.py` asserts agreement to **1e-12** across a parameter × mastery
grid, at the 59.9/60.0 threshold boundary, and over multi-step trajectories — single
steps agreeing is insufficient because errors compound within a session.

This matters because the policy trains against the Python model and is deployed
against the TypeScript one. Drift would mean a policy optimised for a student that
does not exist, with nothing raising an error.

### D2. "Why is the resume parser TF-IDF rather than an LLM?"

Measured against the LLM parser it replaced: ~150× faster (1–6 ms vs 590–880 ms), zero
cost, offline, deterministic, and explainable — and it identified **every** topic the
LLM found.

State the agreement precisely: 100% of the topics the LLM named appeared in the
classical top-5, but only 40–60% of the classical top-5 appeared in the LLM's shorter
list. The honest claim is *no disagreement*, not *identical ranking*.

### D3. "The Python and TypeScript parsers give different numbers. Isn't that a bug?"

They differ by ~0.2 in magnitude because Python lemmatises with spaCy and TypeScript
uses suffix rules. `ml/test_parity.py` therefore asserts the two agree on **which**
topics are gaps and **in what order** — the decision the vector drives — rather than
on floats. Forcing float equality would mean degrading the reference implementation to
match the cruder one.

### D4. "How does the system behave if a component fails?"

Designed to degrade, not break. `lib/kt/store.ts` never throws: a missing table or
failed write costs one data point, while an exception would cost the candidate their
interview. The parser runs before the LLM call, so `/api/resume/parse` still returns
skills and a gap vector when the AI provider is down. The chooser has an explicit
fallback chain: RL policy → Thompson bandit → LLM question plan.

---

## E. Weaknesses — volunteer these

Say them first. Each is already in §5 of the research log.

1. **No human validation.** The strongest possible criticism. Response: bounded claim,
   sensitivity analysis, and a concrete path — the app already records real
   trajectories.
2. **Morale added after seeing v1's null result.** Independently justified, disclosed,
   both results reported.
3. **Topics modelled as independent.** Real skills correlate.
4. **Coverage dominates a 20-question episode**, which flatters round-robin and limits
   how much sequencing can contribute.
5. **Reward is a design choice.** A different shaping would produce a different
   ranking; mastery gain is reported instead for exactly this reason.
6. **Single seed per configuration so far.** Multiple training seeds with error bars
   would strengthen the result. *(Fix before submission: run seeds 0, 1, 2.)*

---

## F. Questions to ask yourself before submitting

- [ ] Does every number in the paper have a command that reproduces it?
- [ ] Are the three failed PPO runs in the paper, not just the successful one?
- [ ] Is F4 (privileged oracles are not ceilings) stated as a general lesson?
- [ ] Is the morale-ordering threat disclosed *before* the results section?
- [ ] Have you run ≥3 training seeds and reported error bars?
- [ ] Does the abstract's claim match §6 of the research log exactly?
