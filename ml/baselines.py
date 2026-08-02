"""Baseline question-choosing policies (Phase 3).

These are what the trained policy has to beat, and choosing them honestly is what
makes the Phase 4 result mean anything. A policy that only beats `random` has proved
very little - random is a straw man in a task where merely asking weak topics helps.

`weakest_first` is the one that matters. It is what a competent engineer would build
without any RL at all, roughly thirty lines, and it is the real bar. `thompson`
mirrors `lib/rl/bandit.ts`, which already ships in the app as the fallback chooser.

All of them see exactly what the trained policy sees: the observation vector, never
the student's hidden true mastery.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

from bkt import DEFAULT_TOPICS
from student_sim import DIFFICULTIES, InterviewEnv


class Policy(Protocol):
    name: str

    def reset(self) -> None: ...

    def act(self, observation: np.ndarray, env: InterviewEnv) -> int: ...


N_TOPICS = len(DEFAULT_TOPICS)


def _mastery_from(observation: np.ndarray) -> np.ndarray:
    """The BKT estimate is the first block of the observation vector."""
    return observation[:N_TOPICS]


def _difficulty_for(mastery: float) -> str:
    """Pick the difficulty band nearest the estimated ability.

    Given to every baseline, deliberately. If only the trained policy could vary
    difficulty, any advantage it showed would be an artefact of the comparison
    rather than evidence that it learned to sequence questions well.
    """
    if mastery < 0.35:
        return "easy"
    if mastery < 0.7:
        return "medium"
    return "hard"


class RandomPolicy:
    """Uniform over all 45 actions. The floor, not a serious competitor."""

    name = "random"

    def __init__(self, seed: int = 0) -> None:
        self._rng = np.random.default_rng(seed)

    def reset(self) -> None:
        pass

    def act(self, observation: np.ndarray, env: InterviewEnv) -> int:
        return int(self._rng.integers(env.action_space.n))


class RoundRobinPolicy:
    """Every topic in turn - what a fixed question list does.

    Close to how the app behaves today via the LLM question plan, so it doubles as
    the "before" condition.
    """

    name = "round-robin"

    def __init__(self) -> None:
        self._index = 0

    def reset(self) -> None:
        self._index = 0

    def act(self, observation: np.ndarray, env: InterviewEnv) -> int:
        topic = DEFAULT_TOPICS[self._index % N_TOPICS]
        self._index += 1
        mastery = float(_mastery_from(observation)[DEFAULT_TOPICS.index(topic)])
        return env.encode_action(topic, _difficulty_for(mastery))


class WeakestFirstPolicy:
    """Always ask the lowest estimated mastery. **The bar that matters.**

    Greedy and myopic: it ignores that a topic may be weak because it is hard to
    move, that the estimate is noisy early on, and that a question below the
    candidate's level teaches nothing. Those are precisely the things a trained
    policy could learn to exploit - and if it cannot beat this, it has not learned
    anything worth deploying.
    """

    name = "weakest-first"

    def reset(self) -> None:
        pass

    def act(self, observation: np.ndarray, env: InterviewEnv) -> int:
        mastery = _mastery_from(observation)
        index = int(np.argmin(mastery))
        return env.encode_action(DEFAULT_TOPICS[index], _difficulty_for(float(mastery[index])))


class ThompsonPolicy:
    """Thompson sampling over topics - a port of `lib/rl/bandit.ts`.

    Included because it already ships in the app as the fallback chooser, so it is
    the honest "what we would use without Model 1" comparison. It balances
    exploration against exploitation, which round-robin and weakest-first do not,
    but it treats each question as an independent draw and so cannot reason about
    sequencing at all.
    """

    name = "thompson"

    def __init__(self, seed: int = 0) -> None:
        self._rng = np.random.default_rng(seed)
        self.reset()

    def reset(self) -> None:
        # Beta(1, 1) per topic: uniform prior over "is asking this topic useful?"
        self._alpha = np.ones(N_TOPICS)
        self._beta = np.ones(N_TOPICS)
        self._last_index: int | None = None
        self._last_mastery: np.ndarray | None = None

    def act(self, observation: np.ndarray, env: InterviewEnv) -> int:
        mastery = _mastery_from(observation)

        # Reward the arm if the previous pull actually moved the estimate. This is
        # the same "did that help?" signal the TypeScript bandit uses.
        if self._last_index is not None and self._last_mastery is not None:
            moved = abs(float(mastery[self._last_index] - self._last_mastery[self._last_index]))
            if moved > 0.01:
                self._alpha[self._last_index] += 1
            else:
                self._beta[self._last_index] += 1

        samples = self._rng.beta(self._alpha, self._beta)
        # Bias toward weak topics, matching the TypeScript implementation, which
        # weights arms by remaining headroom rather than sampling utility blind.
        index = int(np.argmax(samples * (1.0 - mastery)))
        self._last_index = index
        self._last_mastery = mastery.copy()
        return env.encode_action(DEFAULT_TOPICS[index], _difficulty_for(float(mastery[index])))


class GreedyOraclePolicy:
    """Cheats, but chooses greedily: perfect information, no planning.

    **This is no longer a ceiling, and that is the headline finding of Phase 3.**

    Before morale was added it scored 0.155 against weakest-first's 0.126 and looked
    like an upper bound. With morale it scores *below* weakest-first: it relentlessly
    picks whichever topic offers the most immediate learning, those are exactly the
    topics the candidate answers badly, and their morale - and with it their learning
    rate - collapses.

    Kept precisely because it loses. It demonstrates that perfect knowledge of the
    candidate is not sufficient here; the task requires sequencing. That is the
    argument for a learned policy, and it is much stronger evidence than a baseline
    table where the cheating policy simply wins.
    """

    name = "greedy-oracle"

    def reset(self) -> None:
        pass

    def act(self, observation: np.ndarray, env: InterviewEnv) -> int:
        student = env.student
        assert student is not None
        best_action, best_gain = 0, -1.0
        for topic in DEFAULT_TOPICS:
            ability = student.true_mastery[topic]
            for difficulty in DIFFICULTIES:
                from student_sim import DIFFICULTY_LEVEL

                level = DIFFICULTY_LEVEL[difficulty]
                fit = float(
                    np.exp(-((level - ability) ** 2) / (2.0 * student.params.zpd_width**2))
                )
                gain = student.params.learning_rate * fit * (1.0 - ability)
                if gain > best_gain:
                    best_gain, best_action = gain, env.encode_action(topic, difficulty)
        return best_action


def evaluate(
    policy: Policy, env: InterviewEnv, episodes: int = 200, seed: int = 0
) -> dict[str, float]:
    """Run a policy and report what it achieved.

    `true_mastery_gain` is the headline number, not `reward`: reward includes the
    time cost and reward shaping, so comparing policies on it would compare our
    choice of shaping as much as their behaviour.
    """
    gains, rewards, unique_topics = [], [], []
    for episode in range(episodes):
        observation, _ = env.reset(seed=seed + episode)
        policy.reset()
        total_reward = 0.0
        asked = set()
        while True:
            action = policy.act(observation, env)
            asked.add(env.decode_action(action)[0])
            observation, reward, terminated, truncated, info = env.step(action)
            total_reward += reward
            if terminated or truncated:
                break
        gains.append(info["true_mastery_gain"])
        rewards.append(total_reward)
        unique_topics.append(len(asked))

    return {
        "policy": policy.name,
        "mastery_gain_mean": float(np.mean(gains)),
        "mastery_gain_std": float(np.std(gains)),
        # Standard error, because the comparison that matters is between policy
        # means over many episodes, not between single interviews.
        "mastery_gain_stderr": float(np.std(gains) / np.sqrt(len(gains))),
        "reward_mean": float(np.mean(rewards)),
        "unique_topics_mean": float(np.mean(unique_topics)),
        "episodes": float(episodes),
    }


class LookaheadOraclePolicy:
    """Cheats *and* plans - the estimated ceiling.

    Scores each action by its immediate learning plus the morale it leaves behind,
    valued across the remaining questions. Sometimes it spends a question somewhere
    the candidate is strong: little learning now, but it keeps them answering well
    enough to learn from everything after.

    Uses hidden state (true mastery, morale, and the student's own morale
    parameters), so a trained policy is not expected to match it. It exists to answer
    "how much headroom is there?" - the question that, asked late, made the earlier
    version of this environment look far more promising than it was.

    `morale_weight` is tuned, not derived: 0.05 was the best of the values tried, and
    the curve is genuinely non-monotonic (0.10 and 0.20 are worse than greedy), which
    is itself evidence that the trade-off is real rather than "more morale is better".
    """

    name = "lookahead-oracle"

    def __init__(self, morale_weight: float = 0.05) -> None:
        self.morale_weight = morale_weight

    def reset(self) -> None:
        pass

    def act(self, observation: np.ndarray, env: InterviewEnv) -> int:
        from student_sim import DIFFICULTY_LEVEL, MORALE_FLOOR

        student = env.student
        assert student is not None
        remaining = env.questions_per_episode - env.step_count
        params = student.params

        best_value, best_action = -np.inf, 0
        for topic in DEFAULT_TOPICS:
            ability = student.true_mastery[topic]
            effective = student.effective_ability(topic)
            for difficulty in DIFFICULTIES:
                level = DIFFICULTY_LEVEL[difficulty]
                fit = np.exp(-((level - ability) ** 2) / (2.0 * params.zpd_width**2))
                gain = params.learning_rate * fit * (1.0 - ability) * student.morale

                p_good = 1.0 / (1.0 + np.exp(-params.discrimination * (effective - level)))
                risen = student.morale + params.morale_recovery * (1.0 - student.morale)
                fallen = student.morale - params.morale_drop * (student.morale - MORALE_FLOOR)
                expected_morale = p_good * risen + (1.0 - p_good) * fallen

                value = gain + self.morale_weight * (expected_morale - student.morale) * remaining
                if value > best_value:
                    best_value, best_action = value, env.encode_action(topic, difficulty)
        return best_action


# Backwards-compatible alias: the greedy version used to be called `oracle`.
OraclePolicy = GreedyOraclePolicy

ALL_BASELINES: list[Policy] = [
    RandomPolicy(),
    RoundRobinPolicy(),
    WeakestFirstPolicy(),
    ThompsonPolicy(),
    GreedyOraclePolicy(),
    LookaheadOraclePolicy(),
]


def main() -> None:
    env = InterviewEnv(seed=0)
    print(f"{'policy':<16}{'mastery gain':>16}{'± stderr':>12}{'topics':>9}{'reward':>10}")
    print("-" * 63)
    for policy in ALL_BASELINES:
        result = evaluate(policy, env, episodes=300)
        print(
            f"{result['policy']:<16}"
            f"{result['mastery_gain_mean']:>16.4f}"
            f"{result['mastery_gain_stderr']:>12.4f}"
            f"{result['unique_topics_mean']:>9.1f}"
            f"{result['reward_mean']:>10.2f}"
        )


if __name__ == "__main__":
    main()
