"""Serve the trained curriculum policy over HTTP (Phase 5).

    .venv/bin/uvicorn serve:app --port 8000

Then:

    curl -X POST localhost:8000/infer -H 'content-type: application/json' \
      -d '{"mastery": {"leadership": 0.1}, "attempts": {}, "recent_scores": [], "step": 0}'

**Why a service at all, when the parser and BKT were ported to TypeScript instead.**
Those are arithmetic; this is a torch network. Reimplementing an MLP's forward pass in
TypeScript to avoid a process is the kind of "clever" that produces a policy which is
subtly not the one that was evaluated. The cost is a second process, and Phase 5's
fallback chain is what makes that cost survivable: if this service is down the interview
continues on the Thompson bandit.

**The request carries state, not a feature vector.** The caller sends what it has -
mastery per topic, attempts per topic, the scores so far - and this module assembles the
observation using the same layout as `InterviewEnv._observation`. Letting the TypeScript
side build the 35-float vector would put the feature layout in two places, and a
mis-ordered vector does not raise: it returns a confident, wrong topic.

**On VecNormalize:** training wrapped the env with `norm_obs=False, norm_reward=True`.
Reward scaling exists only to stabilise the advantage estimate during training and has no
role at inference, so the saved `_vecnormalize.pkl` is deliberately not loaded here. If
observation normalisation is ever switched on, this file must load it or the policy will
be fed inputs on a different scale than it trained on.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

from bkt import DEFAULT_TOPICS
from student_sim import ATTEMPT_SCALE, CONSECUTIVE_FAILURE_CAP, DIFFICULTIES

HERE = Path(__file__).resolve().parent
# v6 is the reported policy: behaviour-cloned from weakest-first, then PPO fine-tuned.
# Overridable so a sensitivity run or a future retrain can be served without an edit.
MODEL_PATH = Path(os.environ.get("POLICY_PATH", HERE / "models" / "ppo_v6_seed0.zip"))

DEFAULT_QUESTIONS = 20
# Matches the BKT prior for a topic never asked. A caller that omits a topic is saying
# "no information", which is what the prior means - not "mastery zero".
DEFAULT_PRIOR = 0.25
# The observation uses 0.5 for "no scores yet" rather than 0.0, so an empty history reads
# as neutral instead of as a run of failures.
NEUTRAL = 0.5

_model = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Load the policy once at startup.

    Loading per request would add ~200ms to a call the app gives a 1.5s budget, and the
    app's fallback would then fire on a healthy service under load.
    """
    global _model
    from stable_baselines3 import PPO

    from sb3_compat import load_model

    if not MODEL_PATH.exists():
        raise SystemExit(
            f"No policy at {MODEL_PATH}\n"
            "Train one first, or set POLICY_PATH to an existing .zip."
        )
    _model = load_model(PPO, str(MODEL_PATH))
    print(f"Loaded policy: {MODEL_PATH.name}")
    yield
    _model = None


app = FastAPI(title="PrepSense curriculum policy", lifespan=lifespan)


class InferRequest(BaseModel):
    """The interview state as the app knows it.

    Missing topics fall back to the prior rather than erroring: a first-ever session has
    no rows in `knowledge_state` for topics the parser did not seed, and refusing to
    answer would push every new user onto the fallback chooser.
    """

    mastery: dict[str, float] = Field(default_factory=dict)
    attempts: dict[str, int] = Field(default_factory=dict)
    # Chronological, oldest first - the streak feature reads from the end.
    recent_scores: list[float] = Field(default_factory=list)
    step: int = 0
    questions: int = DEFAULT_QUESTIONS
    # Sampling explores; argmax is reproducible. Defaults to deterministic because two
    # runs of a demo giving different questions from identical state reads as a bug.
    deterministic: bool = True


class InferResponse(BaseModel):
    topic: str
    difficulty: str
    action: int
    policy: str


def build_observation(request: InferRequest) -> np.ndarray:
    """Assemble the 35-float observation: 15 mastery + 15 attempts + 5 progress.

    Kept as a free function so it can be tested without starting a server, and so the
    parity test against `InterviewEnv._observation` has something to call.
    """
    estimated = [float(request.mastery.get(t, DEFAULT_PRIOR)) for t in DEFAULT_TOPICS]
    attempts = [
        min(1.0, request.attempts.get(t, 0) / ATTEMPT_SCALE) for t in DEFAULT_TOPICS
    ]

    scores = request.recent_scores
    window = scores[-3:]
    recent = float(np.mean(window) / 100.0) if window else NEUTRAL
    # Guarded: `questions` arriving as 0 would be a divide-by-zero on a request the
    # caller thinks is well formed.
    progress = request.step / request.questions if request.questions else 0.0

    consecutive = 0
    for score in reversed(scores):
        if score < 60.0:
            consecutive += 1
        else:
            break
    streak = min(1.0, consecutive / CONSECUTIVE_FAILURE_CAP)
    last_five = float(np.mean(scores[-5:]) / 100.0) if scores else NEUTRAL
    session = float(np.mean(scores) / 100.0) if scores else NEUTRAL

    return np.array(
        estimated + attempts + [recent, min(1.0, progress), streak, last_five, session],
        dtype=np.float32,
    )


def decode_action(action: int) -> tuple[str, str]:
    """Inverse of `InterviewEnv.decode_action` - same divmod, same topic ordering."""
    topic_index, difficulty_index = divmod(action, len(DIFFICULTIES))
    return DEFAULT_TOPICS[topic_index], DIFFICULTIES[difficulty_index]


@app.get("/health")
def health() -> dict:
    """Used by the app to decide whether to try `/infer` at all."""
    return {"ok": _model is not None, "policy": MODEL_PATH.name}


@app.post("/infer", response_model=InferResponse)
def infer(request: InferRequest) -> InferResponse:
    assert _model is not None, "lifespan did not run"
    observation = build_observation(request)
    action, _ = _model.predict(observation, deterministic=request.deterministic)
    topic, difficulty = decode_action(int(action))
    return InferResponse(
        topic=topic, difficulty=difficulty, action=int(action), policy=MODEL_PATH.stem
    )
