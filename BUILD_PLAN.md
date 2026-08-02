# PrepSense — Build Plan

> Status: **decided.** RL (DQN/PPO) is a hard requirement.
> Timeline: **~3 weeks, compressed.** Speed prioritised over completeness.
> Scope: **build 3 models** — Model 5 (parser), Model 2 (BKT), Model 1 (RL).
> Models 3 and 4 are integrations that already work; they need a free API key, not building.
> Companion to `PROJECT_CONTEXT.md` (what exists) and `PROGRESS.md` (what's done).

## Cut from earlier drafts — do not re-add without a reason
- **Real-user data collection** — the simulator is the evaluation.
- **Distilled evaluation model** — Model 3 stays an API call.
- **KT dataset fitting (ASSISTments/EdNet)** — hand-set BKT params + sensitivity analysis instead. Avoids access-request delay, and the math-to-interview domain transfer was always arguable.
- **Hyperparameter sweeps** — PPO defaults are fine on a 45-action discrete env.
- **Redis, FastAPI rewrite, React Router/Axios SPA, self-hosted WhisperX.**

---

## 1. The situation in one paragraph

There are two PrepSenses. The **Eraser diagrams** describe a Python/FastAPI research system: five models, DQN/PPO curriculum control, Bayesian Knowledge Tracing, self-hosted Whisper, Postgres + Redis in five Docker containers on EC2. The **codebase** is a working Next.js 16 + Supabase product with auth, JD selection, a live interview room, LLM evaluation, scoring, and reports. These overlap less than they appear. The plan below keeps the working product and builds the diagrams' genuinely valuable parts on top of it.

## 2. What I am optimizing for

1. **Never lose a working demo.** There is a functioning end-to-end flow today. Every phase must end with the app still running.
2. **Build the spine before the branches.** Knowledge State is the one component Models 1, 3, and the dashboard all depend on. It goes first.
3. **Don't pay for architecture you don't need yet.** Redis, five containers, and a service mesh are costs, not features, at one concurrent user.
4. **Make the ML claim defensible.** An adaptive system that demonstrably beats a random baseline is worth more than a PPO agent that outputs noise.

## 3. The central technical decision

**Problem:** DQN/PPO needs 10⁴–10⁵ episodes to converge. Real usage will produce ~50. Built as drawn, the RL controller learns nothing and loses to random selection.

**Solution:** Train the policy against a **simulated student**, not live users.

BKT (Model 2) is a *generative* model, not just a tracker. Given per-topic `(p_learn, p_slip, p_guess, p_init)`, you can roll out millions of synthetic learners offline in seconds. So:

```
BKT params → student simulator → PPO trains offline (millions of episodes)
           → frozen policy ships → serves real users at inference only
```

This converts an impossible cold-start into a tractable supervised-ish problem, and yields a real evaluation: **policy vs. random vs. weakest-first**, measured as mastery gain per question on held-out simulated learners. That comparison is the project's headline result.

## 4. Mapping: diagram → code

| Diagram | Status | Lives in / goes in |
|---|---|---|
| Model 3 — LLM Answer Evaluation | ✅ built | `lib/ai/router.ts`, `lib/prompts/`, `lib/scoring/index.ts` |
| Model 5 — Resume/JD Parser | ⚠️ built, LLM instead of TF-IDF | `app/api/resume/parse/route.ts`, `buildGapMatrix` |
| Model 4 — ASR | ⚠️ built, hosted Whisper API not local | `app/api/interview/transcribe/route.ts` |
| Model 2 — Knowledge Tracing (BKT) | ❌ missing | **Phase 1** — new `lib/kt/bkt.ts` + `knowledge_state` table |
| Model 1 — RL Curriculum Controller | ❌ missing | **Phase 2** (bandit) → **Phase 4** (PPO) |
| Knowledge Map dashboard | ❌ missing | **Phase 3** |

Note: `lib/rl/bandit.ts` is a complete Thompson Sampling implementation that **is imported by zero files**. It is dead code today and free adaptivity tomorrow.

## 4b. Sprint 1 — two weeks, models only

Scope: Python package `ml/`, standalone. No Next.js changes, no UI, no deployment.
Everything here is testable offline with zero AI credits and zero users.

**Action space:** the 15 tags already in `lib/rl/bandit.ts:DEFAULT_TAGS` × 3 difficulties = 45 actions.
**State vector:** 15 masteries + per-topic attempt counts + recent-correctness window + session position ≈ 45–50 dims.
**Reward:** Σ mastery gain across topics, minus a penalty for asking already-mastered topics, minus a small per-question time cost.

| Day | Deliverable |
|---|---|
| 1–2 | `ml/bkt.py` — BKT update + fit. Unit tests on synthetic sequences. |
| 3–5 | `ml/student_sim.py` — Gymnasium env wrapping BKT. Reset/step/reward. Sanity: a random policy plateaus, an oracle policy doesn't. |
| 6–7 | `ml/baselines.py` — random, round-robin, weakest-first, Thompson bandit (port of `lib/rl/bandit.ts`). These are the numbers PPO must beat. |
| 8–10 | `ml/train_ppo.py` — Stable-Baselines3 PPO. Also DQN for the comparison the diagram asks for. Log to TensorBoard. |
| 11–12 | Hyperparameter sweep + learning curves. Checkpoint the best policy. |
| 13–14 | `ml/evaluate.py` — policy vs. all baselines on held-out simulated learners, fixed seeds, confidence intervals. Write up results. |

**Sprint exit criterion:** a plot showing PPO beating weakest-first and random on mastery-gain-per-question, with error bars, reproducible from a seed. That plot is the project's central claim.

**Explicitly not in this sprint:** the FastAPI `/infer` service, Next.js integration, the dashboard, real user data.

## 5. Phases

### Phase 0 — Unblock (hours)
Nothing downstream is real while `MOCK_AI=true`.
- Get one provider live (Gemini free tier resets; or run LM Studio for `lib/ai/lmstudio.ts`).
- Fix `PROJECT_CONTEXT.md`: it says Next 14, actual is **Next 16.2.9 / React 19.2.4**. Per `AGENTS.md`, read `node_modules/next/dist/docs/` before framework-level changes.
- Confirm migration 005 is applied.

**Done when:** a full interview runs against a real model.

### Phase 1 — Knowledge State (Model 2) — *the spine*
- Migration `006`: `knowledge_state (user_id, topic, mastery, p_learn, p_slip, p_guess, n_attempts, updated_at)`, RLS on, unique `(user_id, topic)`.
- `lib/kt/bkt.ts` — posterior update on evidence, then learn-rate transition. ~40 lines, pure functions, unit-testable with no DB.
- Derive the binary observation from the rubric score already computed in `lib/scoring/index.ts` (STAR, hedging, ownership, filler rate are all there already — the signal is free).
- Write from `app/api/interview/answer/route.ts` **per answer**, not at session end.
- Seed priors from the existing `gap_matrix`.

**Done when:** mastery per topic visibly moves across two sessions, and BKT unit tests pass.

### Phase 2 — Adaptive selection v1 (Model 1a)
- Wire `lib/rl/bandit.ts` to `knowledge_state` and into `generateQuestionPlan`.
- Thompson sampling picks topics; the LLM still writes the question text.
- Log `(state, action, reward, next_state)` to a `rl_experience` table from day one — even unused, this is training data accumulating.

**Done when:** two users with different weak areas get measurably different question plans.

### Phase 3 — Knowledge Map dashboard
- `GET /api/knowledge-map` over `knowledge_state`.
- Lift the Recharts radar out of `components/report/ReportView.tsx:198` into a shared component; render persistent cross-session mastery + weak-topic tips.

**Done when:** the dashboard shows mastery that changes after an interview. **This is the demo.**

### Phase 4 — Real RL (Model 1b) — *only if required*
- Small Python service (FastAPI legitimately, for **one** service — not a rewrite).
- BKT-driven student simulator → PPO via Stable-Baselines3, trained offline.
- `POST /infer` returns `(topic, difficulty)`; Next.js falls back to the Phase-2 bandit on timeout or error.
- Reward = mastery gain, penalized for re-asking mastered topics.
- Deliverable: the policy-vs-random-vs-weakest-first comparison.

## 6. Deliberately cut

- **Redis** — Supabase Postgres covers session cache and replay buffer at this scale. A fifth container earning nothing.
- **TF-IDF / spaCy / scikit-learn parsing** — the LLM parser is better and already works. Keep the diagram's *interface*, drop its 2018 implementation.
- **FastAPI rewrite of the whole backend** — weeks spent re-earning ground already held. The Next.js route handlers are the gateway.
- **React Router / Axios / Zustand SPA** — App Router already does this. (`zustand` is in `package.json` and used nowhere; either use it in Phase 3 or drop it.)

## 7. Risks

| Risk | Mitigation |
|---|---|
| RL never converges on real data | Simulator-trained offline policy (§3) |
| No working AI provider | Phase 0 blocks everything; LM Studio as the no-quota fallback |
| BKT observation signal is noisy | Threshold rubric scores; tune `p_slip`/`p_guess` on collected data |
| Scope creep into a full rewrite | §6 is a standing "no" list |
| Dev bypass masks RLS bugs | Run the full flow with `NEXT_PUBLIC_DEV_BYPASS=false` before shipping |

## 8. Open questions

1. ~~Is DQN/PPO a hard requirement?~~ **Answered: yes.** Phase 4 is mandatory; the simulator leads rather than trails.
2. ~~Deadline?~~ **Answered: long.** Sprint 1 is 2 weeks, models only.
3. **Is the EC2/Docker deployment required**, or is Vercel + one small model host acceptable? (`vercel.json` suggests Vercel is the live target.) Not blocking until Phase 5.
4. **Do you have a public dataset for pretraining** (the diagram mentions one as optional)? If yes, BKT parameters can be fit to real data instead of hand-set — meaningfully strengthens the simulator's credibility. EdNet or the ASSISTments datasets are the usual choices.
