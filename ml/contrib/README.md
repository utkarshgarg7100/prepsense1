# `ml/contrib/` — contributed models

Work by collaborators, each building a model that runs **beside** an existing component of
the app rather than replacing it. See `ml/README.md` for why that rule exists.

| Folder | Who | Model | Sits beside |
|---|---|---|---|
| `evaluation/` | Friend A | 3 — Answer evaluation | Groq worksheet scoring (`lib/ai/reconcile.ts`) |
| `knowledge_tracing/` | Friend B | 2 — Knowledge tracing | BKT (`ml/bkt.py`) |
| `parser/` | Friend C | 5 — Resume/JD understanding | TF-IDF parser (`ml/parser.py`) |

Model 1 (the RL curriculum controller) is the repo owner's and lives in `ml/` root — it is
already trained and integrated.

## Each folder contains

| File | What it is |
|---|---|
| `START_HERE.md` | Self-contained onboarding — setup, rules, git flow, pre-PR checks. Read first. |
| `BRIEF.md` | The actual task: what to build, how it integrates, steps in order, definition of done. |
| `requirements.txt` | Dependencies for **this model only** — kept out of the core `ml/requirements.txt`. |

## Keep your dependencies out of the core

Add what you need to your own `contrib/<folder>/requirements.txt`, not to
`ml/requirements.txt`. Three people adding a different deep-learning stack to one shared
file is how a working environment stops installing for everybody.

```bash
cd ml
.venv/bin/pip install -r requirements.txt                    # core, everyone
.venv/bin/pip install -r contrib/<your folder>/requirements.txt   # yours
```

If your model genuinely needs a *different version* of something the core already pins,
raise it before installing — that is a conflict to resolve in conversation, not silently.

## The rule that applies to everyone here

Your service being down must never break the app. It is a required pre-PR check, and it is
already proven achievable: the Phase 5 demo involved killing the RL policy service
mid-interview, and the interview carried on.
