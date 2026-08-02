# Friend C — Model 5: Resume / JD understanding

**Read `ml/README.md` first.** It has the rules that apply to all three of you.

## What the app does today

Before an interview starts, the parser reads the candidate's CV and the job description
together and produces **one number per topic, for all 15 topics** — roughly "how much of a
gap is there here?" That vector seeds the candidate's starting mastery, which is what the
RL controller reads when choosing the first questions.

It works in two stages (`ml/parser.py`):

1. **TF-IDF** — compares the two documents and finds which words stand out.
2. **A hand-written keyword list** maps those words to the 15 topics. About 15 words per
   topic:

```python
'system-design': ['system design', 'architecture', 'scalability',
                  'distributed', 'microservice', 'caching', ...]
```

No training. Nothing is saved between runs — it fits on the two documents in front of it
and throws the result away.

## The weakness you are fixing

**Keyword matching is literal, and it fails silently.**

A CV says "horizontal scaling"; the list has "scalability". Missed. A technology that did
not exist when the list was written. Invisible. Someone describes their work without ever
using the canonical noun. Nothing.

Nothing errors — the topic just quietly scores zero, and the candidate's interview starts
pointed slightly the wrong way.

There is a second, subtler issue worth mentioning in your write-up: TF-IDF is designed to
weigh a document against a *large collection*. Here it runs on two documents. It works, but
the statistics are thin.

## What you are building

A version that matches **meaning instead of words**, using embeddings — so "horizontal
scaling" and "scalability" land near each other automatically, with no list to maintain.

## Be aware of the trade-off you are making

This is the one project where the existing implementation has a real advantage you are
giving up, and you must handle this honestly:

**The current parser is completely explainable.** You can point at any output and say
exactly why: *"the word 'Kubernetes' appeared, which maps to system-design."* That is why
it was chosen — `PHASES.md` Phase 1 calls it "fully explainable" and it was already
benchmarked against an LLM parser as a baseline (`scripts/compare-parsers.ts`).

An embedding model gives you a number with no reason attached. **So your job is not just
"be more accurate" — it is "be enough more accurate to justify losing the explanation."**
That framing is what makes this a real piece of research rather than a swap.

Mitigation worth building: report the *nearest matching phrase* from the CV for each topic
score. It restores some explainability and takes very little extra work.

## Scope honestly — this is the smallest of the three projects

Its output only seeds the *starting* estimate. As soon as the candidate answers anything,
BKT begins correcting it from evidence. So a better parser improves the first few
questions, not the whole interview.

That is not a reason to do it badly — it is a reason to be precise about what you claim.
"Better opening question targeting" is defensible. "Better interviews" is not.

Also note: you will most likely use a *pre-trained* embedding model, so be clear in your
write-up that the training was not yours. Fine-tuning it on CV/JD text would be your own
contribution, and worth doing if time allows.

## How it plugs into the app

```
CV + job description uploaded
      │
      ├──▶ ml/parser.py  (current, stays)  ──▶ 15 numbers ──▶ seeds mastery
      │
      └──▶ YOUR service  ──▶ 15 numbers ──▶ recorded alongside for comparison
```

**Hard requirements on your output**, taken from the Phase 1 bug guard in `PHASES.md`:

- Exactly **15** values, in the **exact order** of `DEFAULT_TOPICS` in `ml/bkt.py`
- Every value in **[0, 1]**
- **Never throws.** Empty CV, garbage input, a PDF that extracted as nothing — return a
  valid vector anyway.

That guard exists because a malformed vector here corrupts everything downstream
*silently*. Assert it in your own tests, not just at the boundary.

The 15 topics and their order are **frozen** — see `ml/README.md`. The RL policy's action
space is indexed by that ordering.

## Steps, in order

1. **Read** `ml/parser.py` (all of it), `ml/test_parser.py` (32 tests — the behaviour you
   must match), and `scripts/compare-parsers.ts` (an existing comparison, and a template
   for yours).
2. **Build the comparison harness first.** Assemble 30–50 CV/JD pairs with a human
   judgement of which topics *should* score high. This is your ground truth and it is the
   real work of this project.
3. **Run the current parser through it and record the score.** Baseline before model.
4. **Cheap experiment worth running before any ML:** simply expand the keyword lists.
   Fifteen words per topic is thin; doubling them is an afternoon. If that closes most of
   the gap, that is a genuinely useful finding — report it, do not hide it because it is
   unglamorous.
5. **Build the embedding version.** Embed CV sections and topic descriptions, score by
   similarity.
6. **Compare** all three on the same pairs, and report where each fails — the failure cases
   are the most interesting part of your write-up.
7. **Wrap in a FastAPI service** modelled on `ml/serve.py`, and wire it in alongside.

## Definition of done

- [ ] `contrib/parser/` contains your model, evaluation script, and tests
- [ ] A labelled CV/JD benchmark set with human judgements
- [ ] Results: keyword parser vs expanded-keyword vs embeddings, on the same data
- [ ] Your output passes the guard — 15 values, all in [0,1], never throws, correct order
- [ ] Nearest-phrase explanation for each topic score
- [ ] **Service down → the app falls back to the current parser and starts normally**
- [ ] `pytest -q` in `ml/` still passes all 120 core tests — especially `test_parity.py`,
      which proves the Python and TypeScript parsers still agree
- [ ] `npx tsc --noEmit` is clean

## One trap to avoid

`lib/parse/lexicon.ts` is **generated** from `ml/parser.py` — its header says so. The two
must stay identical or `ml/test_parity.py` fails, and the failure mode in production is a
silently wrong interview focus rather than an error. If you change the Python keyword
lists, regenerate the TypeScript side; do not hand-edit it, and do not "fix" the parity
test to make it pass.
