"""Tests for the inference service (Phase 5).

**The one that matters is `test_matches_env_observation`.** The policy was trained
against `InterviewEnv._observation`; the service builds its own copy of that layout from
data the app supplies. If the two drift - a feature reordered, a scale changed - nothing
raises. The network accepts any 35 floats and returns a confident, wrong topic, which is
indistinguishable from a policy that simply chose badly.

This is the same class of risk as the Python/TypeScript BKT split, and gets the same
treatment: assert the two implementations agree exactly, on state neither one generated.
"""

from __future__ import annotations

import numpy as np
import pytest

from bkt import DEFAULT_TOPICS
from serve import (
    DEFAULT_PRIOR,
    InferRequest,
    build_observation,
    decode_action,
)
from student_sim import DIFFICULTIES, InterviewEnv


def test_observation_shape_and_bounds():
    observation = build_observation(InferRequest())
    assert observation.shape == (2 * len(DEFAULT_TOPICS) + 5,)
    assert observation.dtype == np.float32
    # The policy's observation space is Box(0, 1). Anything outside it is off the
    # distribution the network ever saw.
    assert observation.min() >= 0.0 and observation.max() <= 1.0


def test_missing_topics_fall_back_to_the_prior():
    """A first session has no stored mastery for most topics."""
    observation = build_observation(InferRequest(mastery={"leadership": 0.9}))
    leadership = DEFAULT_TOPICS.index("leadership")
    assert observation[leadership] == pytest.approx(0.9)
    for index, topic in enumerate(DEFAULT_TOPICS):
        if topic != "leadership":
            assert observation[index] == pytest.approx(DEFAULT_PRIOR)


def test_empty_history_reads_as_neutral_not_as_failure():
    """0.5, not 0.0 - an unstarted session is not a session going badly."""
    observation = build_observation(InferRequest())
    recent, _progress, streak, last_five, session = observation[-5:]
    assert recent == pytest.approx(0.5)
    assert last_five == pytest.approx(0.5)
    assert session == pytest.approx(0.5)
    assert streak == pytest.approx(0.0)


def test_streak_counts_only_trailing_failures():
    """Morale decays per *consecutive* failure, so order matters and a mean cannot see it."""
    trailing = build_observation(InferRequest(recent_scores=[80.0, 30.0, 30.0]))
    leading = build_observation(InferRequest(recent_scores=[30.0, 30.0, 80.0]))
    assert trailing[-3] > leading[-3]
    assert leading[-3] == pytest.approx(0.0)


def test_progress_is_clamped():
    """A session run past its planned length must not push the feature out of [0, 1]."""
    observation = build_observation(InferRequest(step=40, questions=20))
    assert observation[-4] == pytest.approx(1.0)


def test_zero_questions_does_not_divide_by_zero():
    build_observation(InferRequest(step=3, questions=0))


def test_attempts_saturate_at_the_training_scale():
    observation = build_observation(InferRequest(attempts={"leadership": 99}))
    assert observation[len(DEFAULT_TOPICS) + DEFAULT_TOPICS.index("leadership")] == 1.0


def test_decode_matches_the_environment():
    """Action indices must mean the same thing here as during training."""
    env = InterviewEnv()
    for action in range(len(DEFAULT_TOPICS) * len(DIFFICULTIES)):
        assert decode_action(action) == env.decode_action(action)


def test_matches_env_observation():
    """The service's observation equals the environment's, on a real rollout.

    Driven by stepping the env rather than by hand-built state: the point is to catch a
    layout that is self-consistent but no longer matches what the policy was trained on,
    and hand-built inputs would be written from the same misreading as the code.
    """
    env = InterviewEnv(seed=7)
    env.reset(seed=7)
    rng = np.random.default_rng(7)

    for step in range(12):
        env_observation = env._observation()
        service_observation = build_observation(
            InferRequest(
                mastery=dict(env.knowledge.mastery),
                attempts=dict(env.attempts),
                recent_scores=list(env.recent_scores),
                step=env.step_count,
                questions=env.questions_per_episode,
            )
        )
        assert np.allclose(env_observation, service_observation, atol=1e-6), (
            f"observation drift at step {step}"
        )
        env.step(int(rng.integers(env.action_space.n)))
