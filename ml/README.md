# `ml/` — who owns what

Read this before writing any code in this folder.

## The two zones

```
ml/
├── *.py            ← CORE. Working, integrated, FROZEN. Do not edit.
├── models/         ← trained policy files. Do not edit.
├── runs/           ← training logs, including failed runs. Never delete.
└── contrib/
    ├── evaluation/         ← Friend A  (Model 3 — answer scoring)
    ├── knowledge_tracing/  ← Friend B  (Model 2 — mastery estimation)
    └── parser/             ← Friend C  (Model 5 — resume/JD reading)
```

**Everything directly inside `ml/` is frozen.** It is running in a working app that has
passed its Phase 5 and Phase 6 demos. You work inside your own folder under `contrib/`.

## Why "build alongside", not "replace"

Each of you is building a *second* implementation of something that already exists and
works. That is deliberate, for three reasons.

1. **The project must stay demo-able at all times.** If your model is half-finished the
   week of the viva, the app still runs.
2. **You cannot claim an improvement without a baseline.** "Our model scores answers"
   is not a result. "Our model reduced scoring variance by X% against the existing
   evaluator on the same 50 answers" is a result. That requires the old one to still
   exist and still run.
3. **The RL policy was trained against the current BKT specifically.** Swapping the
   knowledge model underneath it does not raise an error — it silently makes the trained
   policy wrong, because it learned a strategy for a learner that behaves differently.

So: your model runs *beside* the existing one, both get the same input, and you compare
outputs. Replacing the default is a decision taken at the end, on evidence, by the repo
owner — not a side effect of merging.

## Why the core files were not moved into a `core/` folder

It would be tidier. It is not worth it: `ml/serve.py`, every test, `ml/test_parity.py`
and the generated `lib/parse/lexicon.ts` all resolve these modules by their current path.
Moving them to gain a folder name risks breaking a working, demonstrated system for
cosmetics. The boundary is documented instead of enforced by directory — respect it.

## The frozen contract

These are the things the running app depends on. Changing any of them breaks something
that currently works, so they are the "do not touch" list:

| Thing | Where | Why it is frozen |
|---|---|---|
| `DEFAULT_TOPICS` — the 15 topics **and their order** | `ml/bkt.py`, mirrored in `lib/kt/bkt.ts` | The RL policy's action space is indexed by this ordering. Reorder it and every trained action silently maps to the wrong topic. No error, just a wrong interview. |
| `BKTParams` and `update()` | `ml/bkt.py` | The policy was trained against these exact dynamics. |
| `POST /infer` request/response shape | `ml/serve.py` | `lib/ai/chooser.ts` calls it. |
| `ml/models/ppo_v6_seed0.zip` | `ml/models/` | Loaded at runtime. This is the trained model. |
| The parity tests | `ml/test_bkt_parity.py`, `ml/test_parity.py` | They assert the Python and TypeScript copies of the same maths agree. If you make one fail, you have broken one of the two. |

## How your model reaches the app

All three of you use **the same integration pattern**, because the project already proved
it works in Phase 5:

```
your Python model  ──HTTP──▶  a small FastAPI service  ──▶  TypeScript calls it
                                                             with a short timeout
                                                             and falls back to the
                                                             existing implementation
```

Copy `ml/serve.py` as your template — it is a working example of exactly this, including
how to load a model once at startup rather than per request.

**The fallback is not optional.** `lib/ai/chooser.ts` is the reference: if the service is
slow, down, or returns nonsense, the app carries on with the old path. This is why the
Phase 5 demo survives someone killing the Python process mid-interview. Your feature must
survive the same test.

## Before you open a pull request

Every one of these must pass. A PR that has not run them will be sent back.

```bash
# 1. You did not break the frozen core
cd ml && .venv/bin/python -m pytest -q          # 120 tests, all must pass

# 2. The TypeScript still compiles
npx tsc --noEmit                                 # must be silent

# 3. The app still works with your service switched OFF
#    (stop your service, run a full interview end to end)

# 4. Your own tests pass, and you have some
cd ml && .venv/bin/python -m pytest contrib/<your folder> -q
```

Check 3 is the one people skip and the one that matters most. Your model being down must
be survivable, because on demo day it will be.

## Your brief

Read the `BRIEF.md` inside your own folder. It states what you are building, how it plugs
in, the steps in order, and what "done" means.
