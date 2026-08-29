# START HERE — Friend B

## Model 2 — Knowledge tracing

You are building a learned knowledge-tracing model (DKT) to sit beside the existing hand-tuned BKT, and measuring which predicts a candidate's next answer better.

**Your detailed brief is `BRIEF.md`, in this folder. Read this file first, then that one.**

> **This file is a copy**, placed here so you have everything in one folder and never
> need to read the owner's core docs to get started. The canonical versions are
> `ml/README.md` and `COLLABORATION.md` at the repo root. **If they ever disagree with
> this file, they win** — tell the owner so this copy gets refreshed.

---

## 1. Set up, once

```bash
git clone <repo-url> && cd prepsense
npm install
cp .env.example .env.local     # then fill in your own Supabase + Groq keys

cd ml
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m spacy download en_core_web_sm
.venv/bin/python -m pytest -q          # 120 tests — ALL must pass before you touch anything
```

**Python 3.12 specifically** — not 3.13 or 3.14. torch and Stable-Baselines3 wheel support
is unproven there, and it only breaks once you reach the ML work.

If those 120 tests do not pass on a fresh clone, **stop and say so**. Do not start building
on a broken base.

`stable-baselines3` pulls in torch (~800MB). Only the RL training and serving code needs
it; the parser and BKT run without.

## 2. Where you work

```
ml/
├── *.py            ← CORE. Working, integrated, FROZEN. Not yours.
├── models/         ← trained RL policy files. Not yours.
├── runs/           ← training logs. Never delete anything here.
└── contrib/
    └── knowledge_tracing/   ← YOU WORK HERE
```

Everything directly inside `ml/` is frozen. It is running in an app that has already
passed its Phase 5 and Phase 6 demos. **You build inside your own folder.**

### Why you build alongside the existing model, not in place of it

1. **The project must stay demo-able every day.** If your model is half-finished the week
   of the viva, the app still runs.
2. **You cannot claim an improvement without a baseline.** "Our model works" is not a
   result. "Our model beat the existing one by X on the same data" is. That needs the old
   one to still exist and still run.
3. **The RL policy was trained against the current components specifically.** Swapping one
   out underneath it does not raise an error — it silently makes the trained policy wrong.

Replacing the default is a decision taken at the end, on evidence, by the repo owner.

## 3. The frozen contract — do not change these

| Thing | Where | Why |
|---|---|---|
| The 15 topics **and their order** (`DEFAULT_TOPICS`) | `ml/bkt.py`, mirrored `lib/kt/bkt.ts` | The RL policy's action space is indexed by this order. Reorder it and every trained action maps to the wrong topic. No error — just a wrong interview. |
| `BKTParams`, `update()` | `ml/bkt.py` | The policy was trained against these exact dynamics. |
| `POST /infer` shape | `ml/serve.py` | `lib/ai/chooser.ts` calls it. |
| `ml/models/ppo_v6_seed0.zip` | `ml/models/` | Loaded at runtime. This is the trained model. |
| The parity tests | `test_bkt_parity.py`, `test_parity.py` | They assert the Python and TypeScript copies of the same maths agree. Breaking one means you broke one of the two — do not "fix" the test. |

Need something in the core changed? **Ask the owner in the PR.** Do not do it yourself as
a "small fix".

## 4. How your model reaches the app

All three contributors use the same pattern, because the project already proved it works:

```
your Python model ──HTTP──▶ small FastAPI service ──▶ TypeScript calls it with a
                                                      short timeout, and falls back
                                                      to the existing implementation
```

Copy **`ml/serve.py`** as your template — it is a working example, including how to load a
model once at startup rather than per request.

**The fallback is not optional.** `lib/ai/chooser.ts` is the reference implementation: if
the service is slow, down, or returns nonsense, the app carries on. This is why the Phase 5
demo survived someone killing the Python service mid-interview. Yours must survive the same
test.

## 5. Daily git workflow

```bash
git checkout main
git pull                                # start from everyone else's merged work
git checkout -b feature/kt-model        # your own branch

# ... work ...

git add ml/contrib/knowledge_tracing/
git commit -m "Add evaluation harness"
git push -u origin feature/kt-model
```

Then open a **Pull Request** on GitHub. The owner reviews and merges.

**Important: nothing technically stops you pushing to `main`.** Branch protection needs a
paid GitHub plan, so this is an agreement rather than a setting. Never `git push` while
`main` is checked out — run `git branch` first if unsure. If you push to `main` by
accident, say so in the group chat immediately; it is a ten-minute fix, and what costs
real time is somebody else pulling the mistake before they hear about it.

Keep PRs **small and one-idea**. "Add the harness" and "add the model" are two PRs; if a
merge breaks something, small PRs tell you which one did it.

## 6. Run these before every PR

A PR that has not been through these gets sent back. Each has already caught a real bug in
this project.

```bash
cd ml && .venv/bin/python -m pytest -q              # 1. core still passes (120 tests)
npx tsc --noEmit                                     # 2. TypeScript compiles (silence = pass)
                                                     # 3. full interview with YOUR service OFF
cd ml && .venv/bin/python -m pytest contrib/knowledge_tracing -q   # 4. your own tests
```

**Check 3 is the one people skip and the one that matters most.** On demo day, something
will be down. Your component being down must be survivable.

## 7. Two things that must never happen

**Never commit `.env.local`.** It holds real API keys. `.gitignore` blocks it, but check
`git status` before committing anyway. If a key is ever pushed it is compromised even after
deletion — rotate it, don't just delete the file.

**Never delete anything in `ml/runs/`.** Those are training logs including failed runs.
They are the record the write-up depends on. A documented failure is a result; a deleted
one is a gap in the paper.

## 8. Ask before you start, if it touches

- Anything in `ml/` root, `ml/models/`, or `ml/runs/`
- The 15 topics or their order
- Any database migration
- A new dependency in `requirements.txt` or `package.json`
- Anything under `app/`, `lib/`, or `components/`

Not blocked — just not decisions to make alone at 2am.

## 9. Where to read more (optional)

You do not need these to start, but they are the real context:

| File | What it is |
|---|---|
| `ml/contrib/knowledge_tracing/BRIEF.md` | **Your task. Read this next.** |
| `PROGRESS.md` | What is built and why — the running decision log |
| `PHASES.md` | The build plan and each phase's exit criterion |
| `RESEARCH_LOG.md` | Every experiment, including the failed ones. **Finding F9 is the project's central result** |
| `ml/README.md` | The canonical version of this file |
| `COLLABORATION.md` | The canonical git workflow |
