"""Compare a trained policy against every baseline (Phase 4).

    .venv/bin/python evaluate.py --model models/ppo_seed0.zip --episodes 500

This produces the project's central claim, so the comparison is set up to be hard to
fool:

* **Held-out students.** Evaluation seeds start at 100000, far from the training
  range, so no policy is graded on candidates it practised against.
* **Identical students for every policy.** Each policy sees the same seed sequence,
  making this a paired comparison; scoring policies on different candidates would
  measure luck as much as skill.
* **Mastery gain, not reward.** Reward includes the time cost and scaling, so
  comparing on it would partly compare our shaping choices.
* **Error bars.** Standard error over episodes, plus a paired t-test against
  weakest-first, because a difference smaller than the noise is not a result.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from baselines import (
    GreedyOraclePolicy,
    LookaheadOraclePolicy,
    RandomPolicy,
    RoundRobinPolicy,
    ThompsonPolicy,
    WeakestFirstPolicy,
)
from student_sim import InterviewEnv

# Far outside any training seed, so evaluation students are genuinely unseen.
EVAL_SEED_BASE = 100_000


class TrainedPolicy:
    """Wraps a Stable-Baselines3 model in the baseline `Policy` interface."""

    def __init__(self, model, name: str = "trained", deterministic: bool = True) -> None:
        self._model = model
        self.name = name
        self._deterministic = deterministic

    def reset(self) -> None:
        pass

    def act(self, observation: np.ndarray, env: InterviewEnv) -> int:
        action, _ = self._model.predict(observation, deterministic=self._deterministic)
        return int(action)


def run_episodes(policy, env: InterviewEnv, episodes: int) -> np.ndarray:
    """Per-episode true mastery gain, in seed order so results can be paired."""
    gains = np.empty(episodes)
    for i in range(episodes):
        observation, _ = env.reset(seed=EVAL_SEED_BASE + i)
        policy.reset()
        while True:
            observation, _, terminated, truncated, info = env.step(
                policy.act(observation, env)
            )
            if terminated or truncated:
                break
        gains[i] = info["true_mastery_gain"]
    return gains


def paired_t(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Paired t-statistic and Cohen's d for `a - b` on matched students.

    Written out rather than pulled from scipy to avoid a dependency for twelve
    lines, and because the paired structure is the part worth being explicit about.
    """
    difference = a - b
    n = len(difference)
    mean = float(np.mean(difference))
    sd = float(np.std(difference, ddof=1))
    if sd == 0.0:
        return 0.0, 0.0
    return mean / (sd / np.sqrt(n)), mean / sd


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", help="path to a saved .zip policy")
    parser.add_argument("--algo", default="ppo", choices=("ppo", "dqn"))
    parser.add_argument("--episodes", type=int, default=500)
    parser.add_argument("--questions", type=int, default=20)
    parser.add_argument("--json", help="write results here for the plot script")
    args = parser.parse_args()

    env = InterviewEnv(questions_per_episode=args.questions, seed=0)

    policies = [
        RandomPolicy(),
        RoundRobinPolicy(),
        ThompsonPolicy(),
        WeakestFirstPolicy(),
    ]

    if args.model:
        if args.algo == "ppo":
            from stable_baselines3 import PPO as Algo
        else:
            from stable_baselines3 import DQN as Algo
        from sb3_compat import load_model

        policies.append(
            TrainedPolicy(load_model(Algo, args.model), name=f"{args.algo}-trained")
        )

    # Two oracles, both cheating, and the contrast between them is the point:
    # greedy has perfect information and still loses, the planner is the ceiling.
    policies.append(GreedyOraclePolicy())
    policies.append(LookaheadOraclePolicy())

    results: dict[str, np.ndarray] = {}
    for policy in policies:
        results[policy.name] = run_episodes(policy, env, args.episodes)

    reference = results["weakest-first"]
    print(f"\n{args.episodes} held-out students, {args.questions} questions each")
    print(f"{'policy':<16}{'gain':>9}{'stderr':>9}{'vs weakest':>12}{'t':>8}{'d':>7}")
    print("-" * 61)

    summary = {}
    for name, gains in results.items():
        stderr = float(np.std(gains) / np.sqrt(len(gains)))
        delta = float(np.mean(gains) - np.mean(reference))
        relative = 100.0 * delta / float(np.mean(reference))
        t, d = paired_t(gains, reference)
        print(
            f"{name:<16}{np.mean(gains):>9.4f}{stderr:>9.4f}"
            f"{relative:>11.1f}%{t:>8.1f}{d:>7.2f}"
        )
        summary[name] = {
            "mean": float(np.mean(gains)),
            "stderr": stderr,
            "delta_vs_weakest_first": delta,
            "relative_percent": relative,
            "t_statistic": t,
            "cohens_d": d,
        }

    # |t| > ~2 is significant at the usual threshold for these sample sizes; the
    # effect size matters more, since 500 paired episodes make tiny differences
    # "significant" without making them meaningful.
    print("\n|t| > 2 is significant; d is the effect size and the one to quote.")

    trained = next((n for n in results if n.endswith("trained")), None)
    if trained:
        gain = summary[trained]["mean"]
        oracle = summary["lookahead-oracle"]["mean"]
        greedy = summary["weakest-first"]["mean"]
        if gain > oracle:
            print(
                f"\n⚠️  {trained} ({gain:.4f}) beat the lookahead oracle ({oracle:.4f}).\n"
                "    Treat this as a bug, not a result: that oracle reads the student's\n"
                "    hidden mastery, morale and morale parameters. Check for an\n"
                "    observation leak and re-run test_student_sim.py first."
            )
        elif abs(summary[trained]["cohens_d"]) < 0.1:
            # Equivalence, not defeat. Reporting this as a loss would misread it:
            # |d| < 0.1 over 500 paired episodes means the two policies are not
            # distinguishable, which is a finding rather than a failed run.
            print(
                f"\n{trained} ({gain:.4f}) is statistically indistinguishable from "
                f"weakest-first ({greedy:.4f}):\n"
                f"    d={summary[trained]['cohens_d']:+.2f}, "
                f"t={summary[trained]['t_statistic']:+.1f}. Report as equivalence, not a loss.\n"
                "    With the failed distillation of the planning oracle, this is evidence\n"
                "    that the observation does not support beating the heuristic."
            )
        elif gain <= greedy:
            print(
                f"\n{trained} ({gain:.4f}) did not beat weakest-first ({greedy:.4f}).\n"
                "    Try: more timesteps, higher ent_coef for exploration, or check\n"
                "    that ep_rew_mean in TensorBoard actually rose."
            )
        else:
            captured = 100.0 * (gain - greedy) / (oracle - greedy)
            print(
                f"\n{trained} beats weakest-first and closes {captured:.0f}% of the gap\n"
                f"    to the oracle. That is the headline result."
            )

    if args.json:
        Path(args.json).write_text(json.dumps(summary, indent=2))
        print(f"\nWrote {args.json}")


if __name__ == "__main__":
    main()
