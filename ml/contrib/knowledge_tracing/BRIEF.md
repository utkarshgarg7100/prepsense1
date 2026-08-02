# Friend B — Model 2: Knowledge tracing

**Read `ml/README.md` first.** It has the rules that apply to all three of you.

## What you are building

A model that answers: *"given everything this candidate has answered so far, how likely
is it they actually know each of the 15 topics?"*

This already exists as **BKT** (Bayesian Knowledge Tracing) in `ml/bkt.py`. You are
building a second, learned version — the standard modern approach is **DKT** (Deep
Knowledge Tracing): a small recurrent neural network over the sequence of a candidate's
answers.

**You are not filling a hole. You are competing with a working component.** Go in
expecting to have to prove you are better, and know that "we compared them and BKT won"
is still a publishable result.

## Why this is the most valuable of the three projects

Two concrete reasons, both worth stating in your own write-up.

**1. The current model's parameters are guesses.** Open `ml/bkt.py` and look:

```python
p_init  = 0.25   # P(already knows the topic at session zero)
p_slip  = 0.10   # P(answers badly | knows it)
p_guess = 0.08   # P(answers well | does not know it)
```

Four hand-chosen numbers. They are reasoned and documented, but nobody measured them from
real candidates. Normally BKT is *fitted* to learner data. This project skipped that step
because it had no learner data. **Your project is doing the step that was skipped** —
that is a far easier thing to justify than inventing something novel.

**2. It connects to the project's central finding.** The RL controller only *tied* the
simple "always ask the weakest topic" heuristic instead of beating it (see finding **F9**
in `RESEARCH_LOG.md` — read it, it is the paper's main result). One leading explanation is
that the simulated students it trained against were built from BKT, and BKT's model of
learning is too simple for there to be much clever strategy to find. A richer knowledge
model could be what makes the RL result work. **You are potentially fixing the headline
number.**

## The honest difficulty: where does training data come from?

This is the hard part of your project. Face it early — do not discover it in week three.

DKT is normally trained on tens of thousands of students. This project has a handful of
interviews. You have three options and you should probably use more than one:

| Option | What it gives you | The catch |
|---|---|---|
| **Public dataset** (ASSISTments, EdNet — standard KT benchmarks) | Real learner sequences, enough data, comparable to published results | Maths and language exercises, not interviews. Different domain. |
| **Simulated learners** from `ml/student_sim.py` | Unlimited, already built, matches the 15 topics exactly | Generated *by BKT* — so a model trained on it mostly learns to imitate BKT. It cannot prove you beat BKT. Useful for checking your code works, not for claims. |
| **Real data from this app** (`knowledge_history` table) | Genuinely on-domain | Very small. Grows only as people use the app. |

**Recommended: train and benchmark on a public dataset** (that is your credible ML result,
comparable to published numbers), **then fine-tune or at least demonstrate on this
project's topics.** Be explicit in your write-up about which claim rests on which data.

## The data that is already waiting for you

The app has been logging exactly what you need since migration 011. Table
`knowledge_history`, one row per mastery change:

| column | meaning |
|---|---|
| `user_id` | which candidate |
| `topic` | which of the 15 |
| `mastery` | the estimate after this answer |
| `attempts` | how many times this topic has come up |
| `score` | the 0–100 rubric score that caused the move (null for CV-seeded rows) |
| `session_id` | which interview |
| `source` | `'observed'` = a real answer, `'parser'` = starting guess from the CV |
| `created_at` | when |

**Filter to `source = 'observed'` for training.** The `'parser'` rows are the CV-based
starting guess, not evidence of anything — training on them teaches the model that people
improve before answering a question.

Your training sequence is: group by `user_id`, order by `created_at`, and you have each
candidate's answer history in order. That is exactly DKT's input format.

## How it plugs into the app

```
answer submitted
      │
      ▼
score 0–100 from the evaluator
      │
      ├──────────────▶ BKT (ml/bkt.py + lib/kt/bkt.ts)  ── current, stays live
      │
      └──────────────▶ YOUR service  ── runs alongside, result stored for comparison
```

**Critical constraint: you must not change what the RL controller reads.** It consumes
BKT's mastery numbers and was trained against BKT's behaviour. For the whole of your
project, BKT stays the source of truth for the live interview; your model's output is
recorded next to it so the two can be compared. Switching the app over is a decision for
the end, taken on your comparison numbers.

Because DKT is a neural network, it must run as a **service** — same reasoning as
`ml/serve.py` documents for the RL policy: reimplementing a torch forward pass in
TypeScript is how you end up serving a model that is subtly not the one you evaluated.

## Steps, in order

1. **Read first.** `ml/bkt.py` (all of it — the docstrings explain the reasoning), then
   `RESEARCH_LOG.md` finding F9, then `supabase/migrations/011_knowledge_history.sql`.
2. **Build the evaluation harness before the model.** Take a sequence of answers, hide the
   last one, predict it, compare to what actually happened. Metric: AUC (standard in the
   KT literature) plus plain accuracy. **Run BKT through this harness first and write the
   number down.** That is your baseline, and having it before you have a model stops you
   fooling yourself later.
3. **Fit BKT's four parameters to data** before building anything neural. This is a
   half-day of work and it may well close most of the gap — in which case you have found
   something genuinely useful, and a much simpler recommendation for the project.
4. **Build DKT.** Small LSTM/GRU. Input: sequence of (topic, correct/incorrect). Output:
   probability of getting each topic right next.
5. **Compare** all three — hand-tuned BKT, fitted BKT, DKT — on the same harness, same
   held-out data, with error bars.
6. **Wrap the winner in a FastAPI service** modelled on `ml/serve.py`.
7. **Wire it in** behind a flag, writing its predictions alongside BKT's, never replacing.

Steps 2 and 3 are the ones that make this a real experiment rather than a demo. Do not
skip ahead to step 4 because it is the fun one.

## Definition of done

- [ ] `contrib/knowledge_tracing/` contains your model, training script, and tests
- [ ] A results table: BKT vs fitted-BKT vs DKT, AUC + accuracy, on held-out data
- [ ] You can explain *why* the winner won, not just that it did
- [ ] Your service runs and returns predictions for all 15 topics
- [ ] **Killing your service mid-interview changes nothing the candidate can see**
- [ ] `pytest -q` in `ml/` still passes all 120 core tests — especially
      `test_bkt_parity.py`, which proves you did not disturb the existing BKT
- [ ] `npx tsc --noEmit` is clean

## One trap to avoid

If you train on data generated by `ml/student_sim.py` and your model beats BKT — **be
suspicious, not pleased.** That simulator *is* BKT underneath. A model that beats BKT on
BKT-generated data has almost certainly found a bug or an information leak, not an
insight. The same warning is written into Phase 3 of `PHASES.md` about the RL work, and it
applies to you identically.
