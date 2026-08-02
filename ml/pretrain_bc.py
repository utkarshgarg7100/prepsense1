"""Warm-start the policy by imitating an expert, then let PPO improve on it.

    .venv/bin/python pretrain_bc.py --expert lookahead --tag ppo_bc --seed 0
    .venv/bin/python train_ppo.py --resume models/ppo_bc_seed0.zip --tag ppo_v6

**Why this exists.** Five PPO runs from random initialisation all converged to
*state-independent habits* - "always ask an easy question", weakness-rank ~7 (random).
None discovered even the thirty-line weakest-first heuristic, let alone beat it. The
reward signal per action is small and noisy relative to between-student variance, and
random exploration across 45 actions rarely stumbles onto "sort by the first fifteen
features" long enough for the gradient to reinforce it.

The standard remedy is not more compute: it is to stop requiring the agent to
rediscover known-good behaviour. Behavioural cloning fits the policy network to an
expert's decisions by supervised learning, then PPO fine-tunes from there. The policy
starts *at* the baseline instead of far below it, and reinforcement learning is spent
on improving it rather than on finding it.

**Two experts, and the choice matters for what can be claimed.**

* ``weakest-first`` - observation-only. Cloning it can at best reproduce it; PPO must
  supply any improvement. The conservative, easiest-to-defend option.
* ``lookahead`` - the planner that reads hidden state (true mastery, morale). Cloning
  it is **privileged-expert distillation**, standard in robotics teacher-student
  training: the teacher sees everything, the student must approximate its decisions
  from partial observations. The student never sees hidden state at any point - only
  the teacher's *choices* are transferred - so nothing leaks into deployment.

Distilling the planner is the more interesting result: it tests whether the planner's
advantage is *reachable* from the observation alone, which is the open question E5 and
E8 left behind.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"


def collect(expert, env, episodes: int) -> tuple[np.ndarray, np.ndarray]:
    """Roll the expert out and record (observation, action) pairs.

    The observation stored is the *student's* view - what a deployed policy would
    have - while the expert may have chosen using more. That asymmetry is the whole
    point of distillation.
    """
    observations, actions = [], []
    for episode in range(episodes):
        observation, _ = env.reset(seed=episode)
        expert.reset()
        while True:
            action = expert.act(observation, env)
            observations.append(observation.copy())
            actions.append(action)
            observation, _, terminated, truncated, _ = env.step(action)
            if terminated or truncated:
                break
    return np.array(observations, dtype=np.float32), np.array(actions, dtype=np.int64)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expert", default="lookahead", choices=("lookahead", "weakest"))
    parser.add_argument("--episodes", type=int, default=4000)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--tag", default="ppo_bc")
    args = parser.parse_args()

    try:
        import torch as th
        from stable_baselines3 import PPO
    except ImportError:
        raise SystemExit('Run: .venv/bin/pip install "stable-baselines3[extra]"')

    from baselines import LookaheadOraclePolicy, WeakestFirstPolicy
    from student_sim import InterviewEnv

    env = InterviewEnv(seed=args.seed)
    expert = LookaheadOraclePolicy() if args.expert == "lookahead" else WeakestFirstPolicy()

    print(f"Collecting {args.episodes} episodes from '{expert.name}'...")
    observations, actions = collect(expert, env, args.episodes)
    print(f"  {len(observations):,} decisions recorded")

    # A PPO model is constructed only to obtain its policy network; the RL machinery
    # is untouched here, so the saved file loads directly into `train_ppo.py`.
    model = PPO("MlpPolicy", env, seed=args.seed, ent_coef=0.02, verbose=0)
    policy = model.policy
    optimizer = th.optim.Adam(policy.parameters(), lr=args.learning_rate)

    obs_tensor = th.as_tensor(observations)
    act_tensor = th.as_tensor(actions)
    n = len(obs_tensor)
    # Held out so "it learned the expert" is not confused with "it memorised the
    # rollouts" - the same mistake as reading a training curve as evidence of skill.
    split = int(0.9 * n)
    rng = np.random.default_rng(args.seed)
    order = rng.permutation(n)
    train_idx, val_idx = order[:split], order[split:]

    print(f"\nCloning: {args.epochs} epochs over {split:,} decisions")
    for epoch in range(args.epochs):
        policy.set_training_mode(True)
        shuffled = rng.permutation(train_idx)
        total = 0.0
        for start in range(0, len(shuffled), args.batch_size):
            batch = shuffled[start : start + args.batch_size]
            distribution = policy.get_distribution(obs_tensor[batch])
            loss = -distribution.log_prob(act_tensor[batch]).mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total += float(loss) * len(batch)

        policy.set_training_mode(False)
        with th.no_grad():
            predicted = policy.get_distribution(obs_tensor[val_idx]).distribution.probs.argmax(1)
            accuracy = float((predicted == act_tensor[val_idx]).float().mean())
        if epoch % 5 == 0 or epoch == args.epochs - 1:
            print(
                f"  epoch {epoch:>3}  loss {total / len(shuffled):.4f}  "
                f"val action-match {accuracy * 100:.1f}%"
            )

    MODELS.mkdir(exist_ok=True)
    destination = MODELS / f"{args.tag}_seed{args.seed}"
    model.save(destination)
    print(f"\nSaved {destination}.zip")

    # Action-match accuracy is not the goal - matching a teacher that sees hidden
    # state is impossible in principle. Achieved gain is what matters.
    from baselines import evaluate
    from evaluate import TrainedPolicy

    result = evaluate(TrainedPolicy(model, "cloned"), InterviewEnv(seed=0), episodes=300)
    print(f"\nCloned policy: gain={result['mastery_gain_mean']:.4f} "
          f"(weakest-first 0.0789, lookahead-oracle 0.0847)")
    print("\nNow fine-tune with PPO:")
    print(f"  .venv/bin/python train_ppo.py --resume {destination}.zip --tag ppo_v6")


if __name__ == "__main__":
    main()
