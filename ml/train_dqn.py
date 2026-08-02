"""Train the curriculum controller with DQN (Phase 4 comparison).

    .venv/bin/python train_dqn.py --timesteps 300000 --seed 0

The project diagram asks for a DQN comparison, so this exists to provide it
honestly - not because DQN is expected to win. Two reasons to expect PPO ahead:

* DQN is off-policy with a replay buffer, and our episodes are only 20 steps, so
  early transitions from a badly-initialised policy stay in the buffer a long time;
* reward differences between good and mediocre actions are small, and DQN's
  argmax over 45 Q-values is more sensitive to value-estimation noise than PPO's
  stochastic policy is.

Reporting that DQN loses is a result, not a failure - "we tried both and PPO was
better on this task, for these reasons" is a stronger claim than only ever running
the one that worked.
"""

from __future__ import annotations

import argparse
from pathlib import Path

RUNS = Path(__file__).resolve().parent / "runs"
MODELS = Path(__file__).resolve().parent / "models"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timesteps", type=int, default=300_000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--questions", type=int, default=20)
    parser.add_argument("--learning-rate", type=float, default=5e-4)
    parser.add_argument("--tag", default="dqn")
    args = parser.parse_args()

    try:
        from stable_baselines3 import DQN
        from stable_baselines3.common.callbacks import CheckpointCallback
    except ImportError:
        raise SystemExit(
            "stable-baselines3 is not installed. Run:\n"
            '  .venv/bin/pip install "stable-baselines3[extra]" matplotlib\n'
            "(~800MB, mostly torch)"
        )

    from student_sim import InterviewEnv

    RUNS.mkdir(exist_ok=True)
    MODELS.mkdir(exist_ok=True)

    env = InterviewEnv(questions_per_episode=args.questions, seed=args.seed)

    model = DQN(
        "MlpPolicy",
        env,
        seed=args.seed,
        learning_rate=args.learning_rate,
        buffer_size=100_000,
        # 5k steps is 250 complete episodes before learning starts, so the buffer
        # holds a spread of students rather than several visits to one.
        learning_starts=5_000,
        batch_size=128,
        gamma=0.98,
        train_freq=4,
        target_update_interval=1_000,
        # 45 actions and a short horizon: exploration has to last a while or whole
        # regions of the action space are never sampled.
        exploration_fraction=0.3,
        exploration_final_eps=0.05,
        verbose=1,
        tensorboard_log=str(RUNS),
    )

    checkpoint = CheckpointCallback(
        save_freq=50_000,
        save_path=str(MODELS / f"{args.tag}_checkpoints"),
        name_prefix=args.tag,
    )

    print(f"Training DQN for {args.timesteps:,} steps (seed {args.seed}).\n")
    model.learn(
        total_timesteps=args.timesteps,
        callback=checkpoint,
        tb_log_name=f"{args.tag}_seed{args.seed}",
        progress_bar=True,
    )

    destination = MODELS / f"{args.tag}_seed{args.seed}"
    model.save(destination)
    print(f"\nSaved {destination}.zip")


if __name__ == "__main__":
    main()
