# Working on PrepSense together

Four people, four models, one app that has to keep working the whole time.

| Who | Model | Folder | Status |
|---|---|---|---|
| Utkarsh (owner) | 1 — RL curriculum controller | `ml/` root, `ml/models/` | ✅ trained and integrated |
| Friend A | 3 — Answer evaluation | `ml/contrib/evaluation/` | brief written |
| Friend B | 2 — Knowledge tracing | `ml/contrib/knowledge_tracing/` | brief written |
| Friend C | 5 — Resume/JD understanding | `ml/contrib/parser/` | brief written |

Each brief lives in `BRIEF.md` inside the relevant folder. Start with `ml/README.md`.

## The one rule

**Nothing reaches `main` without a pull request the owner approves.** This is an agreement,
not a GitHub setting — see "This is enforced by agreement" below for why, and what that
means for you.

Not because anyone is untrusted — because this repo has to be demo-able every single day
between now and the viva. A broken `main` on the wrong morning costs four people their
demo, not one.

## Setup, once

```bash
git clone <repo-url> && cd prepsense
npm install
cp .env.example .env.local     # then fill in your own Supabase + Groq keys
cd ml && python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q  # 120 tests — must pass before you change anything
```

If those tests do not pass on a fresh clone, stop and say so. Do not start building on a
broken base.

**Python 3.12 specifically** — not 3.13 or 3.14. torch and Stable-Baselines3 wheel support
is unproven there, and it only breaks once you reach the ML work.

## The daily loop

```bash
git checkout main
git pull                              # start from everyone else's merged work
git checkout -b feature/kt-model      # your own branch, descriptive name

# ... work ...

git add ml/contrib/knowledge_tracing/
git commit -m "Add DKT baseline evaluation harness"
git push -u origin feature/kt-model
```

Then open a **Pull Request** on GitHub. The owner reviews and merges.

Branch names: `feature/<what>` for new work, `fix/<what>` for repairs.

## Before you open a PR

Run all four. A PR that has not been through these will be sent back — not out of
pedantry, but because each one has already caught a real bug in this project.

```bash
cd ml && .venv/bin/python -m pytest -q   # 1. core still passes (120 tests)
npx tsc --noEmit                          # 2. TypeScript compiles, silence = pass
                                          # 3. run a full interview with YOUR service OFF
cd ml && .venv/bin/python -m pytest contrib/<your folder> -q   # 4. your own tests
```

**Check 3 is the one people skip and the one that matters most.** Your model being down
must be survivable, because on demo day something will be down. The app already proves it
can survive this — the Phase 5 demo involved killing the RL policy service mid-interview
and the interview carried on. Your component must clear the same bar.

## What a good PR looks like

- **Touches only your own folder.** If you need something changed in the frozen core,
  say so in the PR and let the owner do it — do not do it yourself as a "small fix".
- **One idea per PR.** "Add the evaluation harness" and "add the model" are two PRs. If a
  merge breaks something, small PRs tell you which one did it.
- **Says what you tested**, including the fallback check.
- **Small.** A 2,000-line PR does not get reviewed properly by anyone, including its author.

## What needs a conversation before you start coding

Open an issue or just ask. These are not blocked, they are just not decisions to make
alone at 2am:

- Anything inside `ml/` root, `ml/models/`, or `ml/runs/`
- The 15 topics or their order (see the frozen contract in `ml/README.md`)
- Any database migration
- Adding a dependency to `requirements.txt` or `package.json`
- Anything under `app/`, `lib/`, or `components/`

## This is enforced by agreement, not by GitHub

Be aware of what is actually stopping a bad push to `main`: **nothing technical.** You all
have write access, so `git push` to `main` will succeed if you type it.

This is not an oversight. GitHub gates branch protection on private repositories behind a
paid plan, and personal-account repositories have only one collaborator level — write.
The alternatives were making the repo public before the paper is submitted, or moving to
an organisation with read-only members and forks. For a four-person team that all knows
each other, the agreement is the pragmatic choice.

So the rule stands on trust:

- **Never `git push` while `main` is checked out.** Run `git branch` first if unsure.
- **Everything goes through a pull request**, reviewed by the owner.
- If you do push to `main` by accident, **say so in the group chat immediately.** It is a
  ten-minute fix. What costs real time is somebody else pulling the mistake before they
  hear about it.

If the owner's GitHub Student Developer Pack application comes through
(`education.github.com/pack`, free Pro for students), branch protection can be switched on
and this section replaced with a ruleset.

## Two things that must never be committed

**Never commit `.env.local`.** It holds real API keys. `.gitignore` blocks it, but do not
rely on that alone — check `git status` before committing. If a key is ever pushed, it is
compromised even after deletion: rotate it immediately, do not just remove the file.

**Never delete anything in `ml/runs/`.** Those are training logs, including failed runs.
They are the record the write-up depends on — negative results included. A failed
experiment that is documented is a result; a failed experiment that is deleted is a gap in
the paper.

## If you break `main`

Say so immediately in the group chat. It is fixable in about a minute and nobody minds.
What costs real time is a broken `main` that someone else pulls before they hear about it.
