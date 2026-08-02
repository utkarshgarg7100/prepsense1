"""Does the result survive different BKT assumptions? (Phase 4)

    .venv/bin/python sensitivity.py --model models/ppo_seed0.zip

This is the defensibility argument for the whole project. The BKT parameters were
hand-set, not fitted to data, and the obvious objection is: *your policy only wins
because you chose the numbers that make it win.*

The answer is to sweep them. If the trained policy beats weakest-first across the
plausible range of `p_learn`, `p_slip`, `p_guess` and the softness constant, the
result does not depend on any one guess. If it wins only in a narrow band, that is
worth knowing before the viva rather than during it.

Note what is being varied: the parameters the **system's belief** uses, not the
simulated student's own learning. The policy is being tested for robustness to the
scorecard being miscalibrated - which in production it certainly is, since nobody
fitted it to real interview data.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from bkt import SOFTNESS, BKTParams
from baselines import WeakestFirstPolicy
from evaluate import EVAL_SEED_BASE, TrainedPolicy
from student_sim import InterviewEnv

# Plausible ranges rather than a wide grid. p_guess above ~0.2 would mean interview
# answers can be bluffed, which is the assumption the whole model rejects.
SWEEPS: dict[str, list[float]] = {
    "p_learn": [0.06, 0.09, 0.12, 0.16, 0.20],
    "p_slip": [0.05, 0.10, 0.15, 0.20],
    "p_guess": [0.04, 0.08, 0.12, 0.16],
    "softness": [5.0, 10.0, 15.0, 20.0, 30.0],
}


def evaluate_at(policy, episodes: int, **overrides) -> float:
    softness = overrides.pop("softness", SOFTNESS)
    defaults = {"p_init": 0.25, "p_learn": 0.12, "p_slip": 0.10, "p_guess": 0.08}
    defaults.update(overrides)

    env = InterviewEnv(bkt_params=BKTParams(**defaults), softness=softness, seed=0)
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
    return float(np.mean(gains))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--algo", default="ppo", choices=("ppo", "dqn"))
    parser.add_argument("--episodes", type=int, default=200)
    parser.add_argument("--json", default="sensitivity.json")
    args = parser.parse_args()

    if args.algo == "ppo":
        from stable_baselines3 import PPO as Algo
    else:
        from stable_baselines3 import DQN as Algo

    from sb3_compat import load_model

    trained = TrainedPolicy(load_model(Algo, args.model), name="trained")
    greedy = WeakestFirstPolicy()

    print(f"\n{args.episodes} episodes per cell. Advantage = trained - weakest-first.\n")
    print(f"{'parameter':<12}{'value':>8}{'trained':>10}{'weakest':>10}{'advantage':>12}")
    print("-" * 52)

    results: dict[str, list[dict]] = {}
    wins = 0
    total = 0

    for parameter, values in SWEEPS.items():
        results[parameter] = []
        for value in values:
            trained_gain = evaluate_at(trained, args.episodes, **{parameter: value})
            greedy_gain = evaluate_at(greedy, args.episodes, **{parameter: value})
            advantage = trained_gain - greedy_gain
            total += 1
            wins += advantage > 0
            marker = "" if advantage > 0 else "  <- loses here"
            print(
                f"{parameter:<12}{value:>8.2f}{trained_gain:>10.4f}"
                f"{greedy_gain:>10.4f}{advantage:>+12.4f}{marker}"
            )
            results[parameter].append(
                {
                    "value": value,
                    "trained": trained_gain,
                    "weakest_first": greedy_gain,
                    "advantage": advantage,
                }
            )
        print()

    print(f"Trained policy ahead in {wins}/{total} configurations.")
    if wins == total:
        print("The advantage does not depend on the hand-set BKT parameters.")
    else:
        print(
            "The advantage is parameter-dependent. Report the range where it holds -\n"
            "an honest boundary is a stronger result than an unqualified claim."
        )

    Path(args.json).write_text(json.dumps(results, indent=2))
    print(f"\nWrote {args.json}")


if __name__ == "__main__":
    main()
