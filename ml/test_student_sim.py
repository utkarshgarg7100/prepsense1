"""Sanity checks for the student simulator and baselines (Phase 3).

`PHASES.md` calls this the highest-risk phase, and the risk is specific: a subtly
wrong reward or dynamic produces a beautiful learning curve that means nothing. PPO
will happily optimise a broken environment and report success.

So these tests are less about correctness of individual functions and more about
whether the *learning problem* is well posed:

* is it learnable at all (does an oracle beat random)?
* is it non-trivial (does the oracle beat the obvious greedy heuristic)?
* is the reward bounded, and can it be gamed by not asking questions?
* do episodes terminate, and is everything reproducible from a seed?

If any of these fail, no amount of PPO tuning in Phase 4 will help.
"""

from __future__ import annotations

import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

from bkt import DEFAULT_TOPICS
from baselines import (
    GreedyOraclePolicy,
    LookaheadOraclePolicy,
    RandomPolicy,
    RoundRobinPolicy,
    ThompsonPolicy,
    WeakestFirstPolicy,
    evaluate,
)
from student_sim import (
    DIFFICULTIES,
    DIFFICULTY_LEVEL,
    InterviewEnv,
    SimulatedStudent,
    StudentParams,
    sample_student,
)


@pytest.fixture
def env() -> InterviewEnv:
    return InterviewEnv(seed=0)


# --- environment conformance ---------------------------------------------

def test_env_passes_the_gymnasium_checker():
    """Stable-Baselines3 assumes a conformant env; a violation here surfaces in
    Phase 4 as an incomprehensible shape error deep inside the training loop."""
    check_env(InterviewEnv(seed=0), skip_render_check=True)


def test_observation_matches_the_declared_space(env):
    observation, _ = env.reset(seed=1)
    assert env.observation_space.contains(observation)
    for action in (0, 22, 44):
        observation, _, _, _, _ = env.step(action)
        assert env.observation_space.contains(observation), f"after action {action}"


def test_action_space_covers_every_topic_and_difficulty(env):
    assert env.action_space.n == len(DEFAULT_TOPICS) * len(DIFFICULTIES)
    seen = {env.decode_action(a) for a in range(env.action_space.n)}
    assert len(seen) == env.action_space.n
    for topic in DEFAULT_TOPICS:
        for difficulty in DIFFICULTIES:
            assert env.decode_action(env.encode_action(topic, difficulty)) == (topic, difficulty)


def test_episodes_terminate(env):
    env.reset(seed=2)
    steps = 0
    while steps < 1000:
        _, _, terminated, truncated, _ = env.step(0)
        steps += 1
        if terminated or truncated:
            break
    assert steps == env.questions_per_episode


def test_step_before_reset_raises():
    with pytest.raises(RuntimeError, match="reset"):
        InterviewEnv().step(0)


def test_same_seed_reproduces_the_same_episode():
    """Phase 4's results must be reproducible, and a policy comparison run on
    different students per policy would be measuring luck."""
    def rollout(seed: int) -> list[float]:
        env = InterviewEnv(seed=seed)
        env.reset(seed=seed)
        return [env.step(i % env.action_space.n)[1] for i in range(20)]

    assert rollout(7) == rollout(7)
    assert rollout(7) != rollout(8)


# --- reward integrity (the bug guard) ------------------------------------

def test_reward_is_bounded(env):
    """An unbounded reward lets PPO chase one degenerate action forever."""
    rewards = []
    rng = np.random.default_rng(0)
    for episode in range(30):
        env.reset(seed=episode)
        for _ in range(env.questions_per_episode):
            _, reward, _, truncated, _ = env.step(int(rng.integers(env.action_space.n)))
            rewards.append(reward)
            if truncated:
                break
    assert min(rewards) > -1.0
    # Max possible gain is learning_rate (<=0.26) x reward_scale (10) = 2.6.
    assert max(rewards) < 3.0


def test_reward_tracks_true_learning_not_the_belief(env):
    """The reward must not be payable by moving the BKT estimate alone.

    This is the failure that would be hardest to notice: a policy that games the
    system's *confidence* while teaching the candidate nothing would look excellent
    on every dashboard.
    """
    env.reset(seed=3)
    student = env.student
    assert student is not None
    for topic in DEFAULT_TOPICS:
        student.true_mastery[topic] = 1.0  # nothing left to learn

    total = sum(env.step(a)[1] for a in range(15))
    assert total < 0, "a fully mastered student should yield only the time cost"


def test_doing_nothing_useful_is_not_rewarded(env):
    """Asking an easy question of an already-strong candidate must not pay."""
    env.reset(seed=4)
    student = env.student
    assert student is not None
    student.true_mastery["leadership"] = 0.97
    _, reward, _, _, _ = env.step(env.encode_action("leadership", "easy"))
    assert reward <= 0.0


def test_mastery_never_leaves_the_unit_interval(env):
    rng = np.random.default_rng(1)
    for episode in range(20):
        env.reset(seed=episode)
        for _ in range(env.questions_per_episode):
            observation, _, _, truncated, _ = env.step(int(rng.integers(env.action_space.n)))
            assert np.all(observation >= 0.0) and np.all(observation <= 1.0)
            assert all(0.0 <= m <= 1.0 for m in env.student.true_mastery.values())
            if truncated:
                break


def test_the_policy_cannot_see_true_mastery(env):
    """The observation must contain the BKT estimate, not the hidden state.

    A policy trained on an observation that leaked true mastery would learn from
    information that does not exist at inference time and collapse in production.
    """
    observation, _ = env.reset(seed=5)
    student = env.student
    assert student is not None
    true_vector = np.array([student.true_mastery[t] for t in DEFAULT_TOPICS])
    estimate = observation[: len(DEFAULT_TOPICS)]
    assert not np.allclose(true_vector, estimate, atol=1e-3)


# --- student dynamics ----------------------------------------------------

def test_learning_peaks_when_difficulty_matches_ability():
    """The zone of proximal development is what makes difficulty selection matter.
    Without it the task collapses to 'sort by weakness'."""
    params = StudentParams(learning_rate=0.2, zpd_width=0.25)
    gains = {}
    for difficulty in DIFFICULTIES:
        student = SimulatedStudent(
            params=params, true_mastery={t: 0.55 for t in DEFAULT_TOPICS}
        )
        gains[difficulty] = student.learn("leadership", difficulty)
    # Ability 0.55 sits closest to the "medium" band.
    assert gains["medium"] > gains["easy"]
    assert gains["medium"] > gains["hard"]


def test_a_question_far_above_the_candidate_teaches_little():
    params = StudentParams()
    weak = SimulatedStudent(params=params, true_mastery={t: 0.1 for t in DEFAULT_TOPICS})
    assert weak.learn("leadership", "hard") < weak.learn("conflict", "easy")


def test_stronger_candidates_answer_better():
    rng = np.random.default_rng(0)
    params = StudentParams(score_noise=1.0)
    strong = SimulatedStudent(params=params, true_mastery={t: 0.9 for t in DEFAULT_TOPICS})
    weak = SimulatedStudent(params=params, true_mastery={t: 0.1 for t in DEFAULT_TOPICS})
    strong_scores = [strong.answer("leadership", "medium", rng) for _ in range(50)]
    weak_scores = [weak.answer("leadership", "medium", rng) for _ in range(50)]
    assert np.mean(strong_scores) > np.mean(weak_scores) + 20


def test_scores_are_graded_not_binary():
    """Production feeds graded evidence into BKT; simulating pass/fail would train
    the policy against a coarser signal than it will actually receive."""
    rng = np.random.default_rng(0)
    student = SimulatedStudent(true_mastery={t: 0.5 for t in DEFAULT_TOPICS})
    scores = [student.answer("leadership", "medium", rng) for _ in range(100)]
    assert len(set(np.round(scores, 1))) > 20
    assert all(0.0 <= s <= 100.0 for s in scores)


def test_sampled_students_differ():
    """A policy that meets one learner memorises it. Population variety is what
    forces generalisation."""
    rng = np.random.default_rng(0)
    students = [sample_student(rng) for _ in range(20)]
    means = [s.mean_mastery() for s in students]
    assert np.std(means) > 0.02
    rates = [s.params.learning_rate for s in students]
    assert np.std(rates) > 0.01


def test_difficulty_levels_are_ordered():
    assert DIFFICULTY_LEVEL["easy"] < DIFFICULTY_LEVEL["medium"] < DIFFICULTY_LEVEL["hard"]


# --- the learning problem is well posed ----------------------------------

# 200 episodes keeps the suite quick while leaving the standard errors (~0.002)
# well below the differences being asserted.
EPISODES = 200


@pytest.fixture(scope="module")
def scores() -> dict[str, dict[str, float]]:
    env = InterviewEnv(seed=0)
    return {
        p.name: evaluate(p, env, episodes=EPISODES)
        for p in (
            RandomPolicy(),
            RoundRobinPolicy(),
            WeakestFirstPolicy(),
            ThompsonPolicy(),
            GreedyOraclePolicy(),
            LookaheadOraclePolicy(),
        )
    }


def test_random_is_the_worst_policy(scores):
    """If random ties with the informed policies, the observation carries no useful
    signal and there is nothing for PPO to learn."""
    baseline = scores["random"]["mastery_gain_mean"]
    for name in ("round-robin", "weakest-first", "thompson", "lookahead-oracle"):
        assert scores[name]["mastery_gain_mean"] > baseline, name


def test_perfect_information_alone_is_not_enough(scores):
    """The finding that justifies the RL component at all.

    `greedy-oracle` knows the candidate's hidden mastery exactly and still loses to
    weakest-first, because it chases immediate learning into a run of failures and
    collapses their morale. If this ever passes trivially again - greedy winning -
    the morale dynamics have been broken or removed, and the project is back to a
    task a thirty-line heuristic solves.
    """
    assert (
        scores["greedy-oracle"]["mastery_gain_mean"]
        < scores["weakest-first"]["mastery_gain_mean"]
    )


def test_planning_beats_both_greedy_policies(scores):
    """There must be headroom, and it must come from *sequencing* rather than from
    information: the lookahead oracle sees exactly what the greedy oracle sees."""
    planner = scores["lookahead-oracle"]["mastery_gain_mean"]
    assert planner > scores["greedy-oracle"]["mastery_gain_mean"]
    assert planner > scores["weakest-first"]["mastery_gain_mean"]


def test_the_gap_between_greedy_and_the_planner_is_worth_chasing(scores):
    """Non-triviality. Checked against the *planning* ceiling, not the greedy one.

    Measuring headroom against a greedy oracle is what made the pre-morale version of
    this environment look promising when a heuristic was already within 1% of the
    best observation-limited policy. That mistake is what this test now guards.
    """
    greedy = scores["weakest-first"]["mastery_gain_mean"]
    planner = scores["lookahead-oracle"]["mastery_gain_mean"]
    assert (planner - greedy) / greedy > 0.05


def test_weakest_first_beats_round_robin(scores):
    """Adaptivity must pay, or the scorecard is pointless."""
    assert (
        scores["weakest-first"]["mastery_gain_mean"]
        > scores["round-robin"]["mastery_gain_mean"]
    )


def test_differences_exceed_the_noise():
    """Guards against reading a difference that is really sampling noise - the
    mistake that would make the Phase 4 plot dishonest.

    Uses a **paired** test, matching `evaluate.py`. Both policies are run on the same
    students, so the between-student variance cancels; comparing independent standard
    errors instead would be so conservative that a genuine effect looks like noise -
    which is exactly what this test did on its first version.
    """
    from evaluate import paired_t, run_episodes

    env = InterviewEnv(seed=0)
    planner = run_episodes(LookaheadOraclePolicy(), env, 200)
    greedy = run_episodes(WeakestFirstPolicy(), env, 200)
    t, d = paired_t(planner, greedy)
    assert t > 3.0, f"planner advantage is not distinguishable from noise (t={t:.1f})"


def test_a_policy_that_ignores_the_state_spreads_thin(scores):
    """Round-robin should touch every topic; the oracle should concentrate. If both
    behaved alike, the action space would not be discriminating."""
    assert (
        scores["round-robin"]["unique_topics_mean"]
        > scores["greedy-oracle"]["unique_topics_mean"]
    )


def test_spamming_one_topic_is_punished(scores):
    """The specific failure `PHASES.md` warns about.

    Mastery gain is steepest at low mastery, so a naive reward can make "hammer the
    weakest topic forever" optimal - a policy that would look great in training and
    produce a useless interview. The headroom term must make it decay.

    Note the trap this test fell into first: re-computing argmin every step *is*
    weakest-first, because a topic stops being weakest once it has been asked. A
    genuine spammer has to lock its choice.
    """
    class FixedTopicPolicy:
        name = "spam-fixed-topic"

        def reset(self) -> None:
            self._locked: int | None = None

        def act(self, observation: np.ndarray, env: InterviewEnv) -> int:
            mastery = observation[: len(DEFAULT_TOPICS)]
            if self._locked is None:
                self._locked = int(np.argmin(mastery))
            from baselines import _difficulty_for

            return env.encode_action(
                DEFAULT_TOPICS[self._locked], _difficulty_for(float(mastery[self._locked]))
            )

    spam = evaluate(FixedTopicPolicy(), InterviewEnv(seed=0), episodes=EPISODES)
    assert spam["unique_topics_mean"] == 1.0
    assert spam["mastery_gain_mean"] < 0.5 * scores["weakest-first"]["mastery_gain_mean"]
    assert spam["mastery_gain_mean"] < scores["random"]["mastery_gain_mean"]


def test_asking_a_topic_is_clearly_visible_in_the_observation(env):
    """The "have I already asked this?" signal must be legible to the policy.

    Originally attempts were normalised by episode length, so one attempt showed up
    as 0.05 - next to mastery features that swing by 0.5. Repeating a topic is the
    most costly mistake available here, because gain scales with headroom, and the
    trained policy could not see it: it covered 10 of 15 topics and lost to
    round-robin, which has no intelligence but never repeats.
    """
    observation, _ = env.reset(seed=11)
    n = len(DEFAULT_TOPICS)
    index = DEFAULT_TOPICS.index("leadership")
    assert observation[n + index] == 0.0

    observation, _, _, _, _ = env.step(env.encode_action("leadership", "medium"))
    after_one = observation[n + index]
    assert after_one >= 0.3, (
        f"one attempt registers as {after_one:.3f}; too small for the policy to act on"
    )

    # And it must saturate rather than grow without bound, or the feature would
    # dominate the observation late in an episode.
    for _ in range(6):
        observation, _, _, _, _ = env.step(env.encode_action("leadership", "medium"))
    assert observation[n + index] == 1.0


def test_coverage_beats_no_coverage(scores):
    """Round-robin has no intelligence at all and only wins by never repeating.
    If a trained policy cannot clear this, it has not learned to spread out."""
    assert scores["round-robin"]["unique_topics_mean"] == pytest.approx(15.0, abs=0.1)
    assert scores["round-robin"]["mastery_gain_mean"] > scores["random"]["mastery_gain_mean"]


def test_morale_features_distinguish_answer_order(env):
    """A mean cannot tell "two bad then one good" from "one good then two bad", but
    those leave very different morale, because decay is per *consecutive* failure.

    With only a rolling mean the policy could explain 59% of the variance in hidden
    morale; the consecutive-failure count raises that to 75%. The trained policy had
    plateaued without it - it was being asked to manage something it could barely
    perceive.
    """
    n = len(DEFAULT_TOPICS)

    def observe(scores: list[float]) -> np.ndarray:
        observation, _ = env.reset(seed=21)
        env.recent_scores = list(scores)
        env.step_count = len(scores)
        return env._observation()

    good_last = observe([30.0, 30.0, 90.0])
    bad_last = observe([90.0, 30.0, 30.0])

    # Identical means, so the original feature cannot separate them...
    assert good_last[n * 2] == pytest.approx(bad_last[n * 2])
    # ...but the streak feature must.
    assert good_last[n * 2 + 2] == 0.0
    assert bad_last[n * 2 + 2] > 0.0


def test_observation_features_are_all_production_derivable(env):
    """Every morale feature must come from the score history the app already stores.

    If one of them ever needed the simulator's hidden state, the policy would be
    training on information it cannot have at inference time - the same failure the
    two-level state design exists to prevent.
    """
    observation, _ = env.reset(seed=22)
    assert env.observation_space.contains(observation)
    for _ in range(5):
        observation, _, _, _, _ = env.step(env.encode_action("leadership", "medium"))
    n = len(DEFAULT_TOPICS)
    # Recomputed here from scores alone; must match what the env produced.
    expected = float(np.mean(env.recent_scores[-5:]) / 100.0)
    assert observation[n * 2 + 3] == pytest.approx(expected, abs=1e-6)
