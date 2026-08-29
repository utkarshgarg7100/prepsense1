# PrepSense — what has been built, and how it fits together

A briefing for the three collaborators joining the project. Read this before your own
`ml/contrib/<folder>/BRIEF.md`; it is the context that makes your task make sense.

---

## 1. The one sentence

**An AI interview coach that remembers you between sessions, and uses that memory to
decide what to ask you next.**

Everything below is in service of that sentence. If you only remember one thing, make it
the word *remembers*.

## 2. Why that is the whole point

Almost every AI interview tool is a wrapper around a chat model. You get questions, you
get feedback, and then the session ends and **the system forgets you completely.** Come
back tomorrow and it is talking to a stranger. It cannot know you have already proved you
are good at system design and weak at handling ambiguity, so it cannot adapt.

PrepSense keeps a per-topic estimate of what you actually know, carried across sessions,
and a trained policy reads that estimate to choose each next question.

That is the difference between a product and a demo, and it is what makes this a machine
learning project rather than prompt engineering.

## 3. The five models

We describe the system as five models. Here is what each one genuinely is.

| # | Name | What it does, in plain words |
|---|---|---|
| **5** | Resume/JD parser | Reads your CV and the job ad together, works out where the gaps are |
| **2** | Knowledge tracing (BKT) | Holds one number per topic: *how likely is it this person actually knows this?* |
| **1** | RL curriculum controller | Reads those numbers and decides **what to ask next** |
| **3** | Answer evaluation | Reads your answer and scores it against a rubric |
| **4** | Speech to text | Turns a spoken answer into text |

### The 15 topics

Everything above is expressed in the same vocabulary: **15 topics**, in a **fixed order**,
defined once in `ml/bkt.py:DEFAULT_TOPICS` and mirrored in `lib/kt/bkt.ts`.

This ordering is load-bearing. The RL policy's action space is indexed by it, so
reordering the list silently maps every trained action to the wrong topic — no error, just
a wrong interview. It is the single most dangerous line in the codebase to touch.

## 4. How they connect

```
        ┌── your CV ──┐
        │             ├──▶  [5] parser  ──▶ starting guess for all 15 topics
        └── job ad ───┘                              │
                                                     ▼
                                        ┌──────────────────────────┐
                                        │  [2] BKT — the memory    │  ◀── persists
                                        │  one number per topic    │      between
                                        └──────────────────────────┘      sessions
                                             │                ▲
                    "they're weakest at      │                │  updates after
                     ambiguity"              ▼                │  every answer
                                        ┌──────────────────────────┐
                                        │  [1] RL controller       │
                                        │  picks topic + difficulty│
                                        └──────────────────────────┘
                                                     │
                                    "ask about ambiguity, medium"
                                                     ▼
                                        ┌──────────────────────────┐
                                        │  Groq writes the actual  │
                                        │  question in English     │
                                        └──────────────────────────┘
                                                     │
                        you answer (typed, or spoken ──▶ [4] Whisper)
                                                     ▼
                                        ┌──────────────────────────┐
                                        │  [3] evaluation → score  │
                                        └──────────────────────────┘
                                                     │
                                            score feeds back to [2]
```

**The loop is the product.** Answer → score → memory updates → controller picks the next
topic from the updated memory. Round and round, and it survives you closing the tab.

**Note what the language model does and does not do.** It writes the words and reads the
answers. It does not decide what to ask, and it does not decide what you know. Those are
our models. That separation is deliberate and it is the thing to emphasise if anyone calls
this "just a ChatGPT wrapper".

## 5. Be honest about what is trained

An examiner will ask this, so we should be first to say it. "Model" does not always mean
"we trained it".

| Model | Structure | Where the parameters came from |
|---|---|---|
| 1 — RL controller | Neural network (PPO) | **Trained here**, ~6 runs, `ml/models/ppo_v6_seed0.zip` |
| 2 — BKT | Hidden Markov Model | **Set by hand** — 4 numbers, never fitted to data |
| 5 — Parser | TF-IDF + keyword lexicon | TF-IDF fits itself at runtime; the lexicon is hand-written |
| 3 — Evaluation | Transformer, Llama 3.3 70B | Trained by Meta, consumed through Groq |
| 4 — Speech | Whisper | Trained by OpenAI, served by Groq |

**One model was trained end to end here. Two are classical models running at inference
time. Two are pre-trained foundation models used as services.**

That is a respectable project, stated accurately. What would damage us is implying we
trained five things and being caught.

Worth knowing: BKT is *not* "just a formula" — it is a Hidden Markov Model, the
foundational model of the knowledge-tracing field since 1994. What we lack is fitted
parameters for it, not a model.

**And this is exactly why the three of you are here.** Look at the two hand-made rows in
that table — hand-set BKT parameters, and a hand-written keyword lexicon. Those are two of
your three projects. The third replaces the subjective half of a borrowed model. You are
each pointed at a real, identified weakness, not busywork.

## 6. The research result — say it plainly

This is the paper's central finding and it is **not** the result we set out to get. Do not
soften it; the honesty is the contribution.

> A learned curriculum policy **matches, but does not exceed**, a simple "always ask the
> weakest topic" heuristic (*d* = −0.05, n = 500 paired episodes — statistical
> equivalence, not a loss).

The valuable part is *why*, and it is well evidenced. Four independent lines of evidence
agree:

1. No hand-written heuristic using only the observable state beats weakest-first
2. Five from-scratch PPO runs converge below it
3. Distilling a *planning* oracle collapses; distilling an observation-only expert
   succeeds at 90.6% action match
4. PPO warm-started *at* the baseline still cannot improve on it

Any one of those could be dismissed as bad tuning. Together they say something specific:
**the 7% gap to the oracle is an information gap, not an optimisation failure.** An oracle
with access to hidden mastery and morale gets +7%, but its policy is not a function of
anything the system can observe, so no amount of training can reach it.

The analysis even predicts what would change the result — richer observations: full score
history instead of summary statistics, response latency (already being recorded), answer
length dynamics. **Friend B's work bears directly on this**, because a better knowledge
model changes what the controller can see.

Full detail: `RESEARCH_LOG.md`, finding **F9**.

## 7. What is built and working

Phases 0–6 are complete and demonstrated. Phase 7 (harden, deploy, write up) is the only
one not started.

- Full interview flow — typed or spoken — start to scored report
- Per-topic mastery persisting across sessions, with a dashboard showing all 15 topics,
  the trend over time, and what to work on
- Custom job descriptions: paste text, upload a PDF/DOCX, or give a job-posting URL
- Interview history with transcripts, per-answer analysis, and resume-where-you-left-off
- The RL policy served over HTTP and wired into question selection
- 120 Python tests, plus TypeScript test scripts for the live database and the fallbacks

## 8. Two design rules that explain most of the codebase

**Everything degrades, nothing breaks.** The RL policy is served by a separate Python
process. If it is slow or down, the app falls back to a Thompson bandit, and then to the
language model's own question plan. We tested this by killing the service mid-interview —
the interview carried on. Your model must clear the same bar; it is a required check
before any pull request.

**Scores are computed, not asserted.** The language model never states a score. It fills
in a worksheet of 8 criteria, and for each one it must quote the candidate's own words as
evidence. Our code adds the points up, and *downgrades any full-marks row that arrives
without a quote*. This is why the score and its explanation can never contradict each
other — there is only one of them. See `lib/ai/reconcile.ts`.

## 9. Who is building what

| Who | Model | Folder |
|---|---|---|
| Utkarsh | 1 — RL controller | `ml/` root — **frozen** |
| Friend A | 3 — Answer evaluation | `ml/contrib/evaluation/` |
| Friend B | 2 — Knowledge tracing | `ml/contrib/knowledge_tracing/` |
| Friend C | 5 — Resume/JD parser | `ml/contrib/parser/` |

**Every new model runs *beside* the existing one, never in place of it.** Three reasons,
and they matter:

1. The app must stay demo-able every day between now and the viva.
2. You cannot claim an improvement without a baseline still running to compare against.
3. The RL policy was trained against the *current* BKT. Replace it and nothing errors —
   the trained policy just silently becomes wrong.

Switching a default is a decision taken at the end, on evidence.

## 10. Questions you will be asked, with the honest answer

**"Isn't this just a ChatGPT wrapper?"**
No. The language model writes questions and reads answers. It does not choose what to ask
or decide what you know — a trained RL policy and a Bayesian knowledge model do that, and
they persist between sessions. Remove the language model and the adaptive logic still
stands; remove our models and it is a chatbot.

**"How many models did you actually train?"**
One end to end — the RL controller. Two classical models run at inference. Two are
pre-trained foundation models consumed as services. Three collaborators are now training
models for the components that were not trained.

**"Your RL model didn't beat the simple heuristic. Isn't that a failure?"**
It is a negative result, and it is well evidenced rather than assumed. We showed the gap
is caused by partial observability, not by bad optimisation, using four independent
tests including an oracle-distillation control. A negative result with a mechanism is a
contribution; the failure would have been not knowing why.

**"Why only one AI provider?"**
Deliberate. The old router fell back to a different model whenever an environment variable
was unset or misspelled, so a misconfigured deployment quietly answered with a different
model than intended — a bug you cannot see by reading a transcript. One provider means one
prompt path, one set of quirks, one bill.

**"Where does the data come from?"**
This is our genuine weakness and we should say so first. There is no large dataset of
graded interview answers. The RL model trained in a simulator built on BKT; BKT's own
parameters were reasoned rather than fitted. Every claim in the paper is scoped to what
its evidence actually supports.

---

## Where to read more

| File | What it is |
|---|---|
| `PROGRESS.md` | What is built and why — the running decision log, and the most useful file in the repo |
| `PHASES.md` | The build plan and each phase's exit criterion |
| `RESEARCH_LOG.md` | Every experiment, including failures. **F9 is the conclusion** |
| `EXAMINER_QA.md` | Anticipated viva questions |
| `ml/README.md` | Ownership map and the frozen contract |
| `COLLABORATION.md` | Git workflow |
