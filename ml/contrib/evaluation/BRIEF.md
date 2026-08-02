# Friend A — Model 3: Answer evaluation

**Read `ml/README.md` first.** It has the rules that apply to all three of you.

## What the app does today — understand this before changing it

The current evaluator is **not** "ask the LLM for a score". It is deliberately more
careful than that, and the design is worth keeping:

1. Groq is asked to fill in a **worksheet** — a list of criteria, and for each one it must
   award points *and quote the candidate's own words as evidence*.
2. `lib/ai/reconcile.ts` then **adds the points up**. The score is arithmetic, not opinion.
3. If a criterion awarded full marks but quoted no evidence, reconcile **downgrades it**.

The reason is written at the top of `reconcile.ts`: if you ask a model for a score *and* a
justification, you get two independent outputs and they drift — a 40 explained by reasoning
that adds up to 75. The candidate is then shown a number and an explanation that contradict
each other. So the model never states a score; it gathers evidence, and the score is
derived.

**Do not throw this away.** A bare number from a neural net would be a downgrade for a
coaching tool, because the candidate learns nothing from "72".

## What you are building

Not a replacement. **A trained model that supplies the objective rows of that worksheet.**

Split the scoring criteria in two:

| Needs real language understanding — **Groq keeps these** | Objective and measurable — **you take these** |
|---|---|
| Is the technical content correct? | Did they use STAR structure (Situation/Task/Action/Result)? |
| Is the reasoning sound? | Did they actually answer the question asked, or drift? |
| Is the evidence they cite convincing? | Filler words, hedging, vagueness |
| Is this a real example or a rehearsed script? | Specificity — concrete numbers and outcomes vs generalities |

Your side is *classification*, which small models do well and which you can label
objectively. The left column needs a 70-billion-parameter model and you will not beat it.

Final score = your rows + Groq's rows, added by the same `reconcile.ts` as today.

## Why this is worth doing

**Reproducibility.** An LLM is a sampling process. Ask it twice, get two answers. A trained
classifier gives the same input the same output forever. For a research write-up,
"our scores are reproducible" is a genuine claim.

**One thing you should know, because it affects your baseline:** the evaluation calls used
to run at temperature 1.0 — full randomness — so the same answer genuinely scored
differently on each submission. That has now been fixed (`GRADING_TEMPERATURE = 0` in
`lib/ai/groq.ts`). This makes your job *harder and more honest*: you are measuring against
a stable baseline rather than a deliberately noisy one. Do not quote the old variance
figures as your improvement.

**Cost and volume.** Grading runs on every single answer — it is the heaviest call in the
app. Moving part of it off the API is a real engineering argument.

## The honest difficulty: labels

To train a scorer you need examples of "this answer deserves these points". Where from?

**The trap:** using Groq to label training data. If you do that, you are training a student
to imitate a teacher. The student is capped at being slightly *worse* than the teacher and
inherits all its biases. You cannot then claim your model is better — you have no ground
truth, only agreement with the thing you set out to improve.

**This is exactly why the task split above matters.** The criteria you have taken are
objectively labellable:

- STAR structure — a human can mark 200 answers for this reliably, and two humans will
  agree. Get a second person to label a subset and report inter-rater agreement; that is a
  standard, expected move in a write-up.
- Filler words — countable, no judgement needed.
- Relevance to the question — labellable, and there are public datasets on
  question-answer relevance you can pre-train on.

Do not take on "is this answer good", because nobody can label it consistently and your
model will learn noise.

## How it plugs into the app

```
answer submitted
      │
      ├──▶ Groq: fills the judgement rows of the worksheet  (unchanged)
      │
      └──▶ YOUR service: fills the objective rows
                     │
                     ▼
        lib/ai/reconcile.ts adds it all up  →  one score, one explanation
```

Your output must be rows in the shape `reconcile.ts` already accepts — read
`normaliseCriterion` in that file, it is the contract:

```json
{ "name": "STAR structure",
  "points": 6,
  "max_points": 8,
  "verdict": "partial",
  "evidence": "a direct quote from the candidate's answer",
  "reason": "Situation and Action are clear; no measurable Result" }
```

**`evidence` is required.** `reconcile.ts` downgrades any full-marks row that arrives
without a quote, and it will do that to yours too. Your model must point at the words that
justified its decision. This is a feature — it keeps the coaching value.

## Steps, in order

1. **Read** `lib/ai/reconcile.ts` top to bottom, then `ANSWER_EVALUATION_PROMPT` in
   `lib/prompts/index.ts`. You need to know the existing worksheet before you extend it.
2. **Pick exactly one criterion to start with. STAR structure is the recommended one** —
   clearest definition, easiest to label, most obviously useful to a candidate.
3. **Build the dataset.** Collect answers (the `sessions` table has real transcripts;
   supplement with public interview-answer datasets). Label them by hand. Get a second
   person to label 50 of them and compute agreement.
4. **Baseline first, again.** Measure how consistently the *current* system rates STAR
   structure across repeated runs and against your human labels. Write that number down
   before you build anything.
5. **Train a classifier.** Start embarrassingly simple — TF-IDF plus logistic regression.
   If that gets you to 85%, a transformer may not be worth it, and knowing that is a
   result. Only escalate if the simple thing is not enough.
6. **Report** accuracy against human labels, and agreement between repeated runs, for both
   your model and the current system.
7. **Wrap in a FastAPI service** modelled on `ml/serve.py`.
8. **Wire in behind a flag**, adding your rows to the worksheet — with a fallback so that
   if your service is down, the worksheet is simply the Groq rows as it is today.

## Definition of done

- [ ] `contrib/evaluation/` contains model, training script, dataset notes, and tests
- [ ] A labelled dataset with inter-rater agreement reported
- [ ] Results table: your model vs the current system, against human labels
- [ ] Your service emits valid criterion rows — *with evidence quotes*
- [ ] **Service down → the interview still scores normally, on Groq alone**
- [ ] `pytest -q` in `ml/` still passes all 120 core tests
- [ ] `npx tsc --noEmit` is clean
- [ ] Existing `scripts/test-reconcile.ts` still passes

## One trap to avoid

Do not let your model award points without evidence, and do not "fix" `reconcile.ts` to
stop it downgrading evidence-free rows. That downgrade is the guard that stops the whole
scoring system inventing marks. If your model cannot quote the words that justified its
decision, the honest response is fewer points — not a weakened guard.
