"""Train the curriculum controller with PPO (Phase 4, Model 1).

    .venv/bin/python train_ppo.py --timesteps 300000 --seed 0

Watch it learn:

    .venv/bin/tensorboard --logdir runs/

**What to expect, so a normal run is not mistaken for a broken one.** `ep_rew_mean`
should climb for the first ~50k steps and then flatten. The number that matters is
not reward but mean true mastery gain against the baselines, which `evaluate.py`
reports - reward includes the time cost and would compare our shaping choices as much
as the policies.

**Read this before believing a good result.** Weakest-first scores ~0.126 and the
cheating oracle ~0.155. A trained policy belongs between them. Above the oracle means
a bug, not a breakthrough - most likely the reward or an observation leak, so check
`test_student_sim.py` passes before celebrating.

PPO rather than DQN as the primary: the action space is 45 discrete choices with a
short 20-step horizon, PPO is far less sensitive to hyperparameters than DQN, and
`train_dqn.py` exists to provide the comparison the project diagram asks for rather
than because DQN is expected to win.
"""

from __future__ import annotations

import argparse
from pathlib import Path

RUNS = Path(__file__).resolve().parent / "runs"
MODELS = Path(__file__).resolve().parent / "models"


def build_env(n_envs: int, seed: int, questions: int, normalize: bool = True):
    """Vectorised copies of the interview environment.

    Parallel environments are what make PPO's on-policy sample collection tolerable
    here: each episode is only 20 steps, so a single env spends most of its time in
    Python overhead rather than in the network.

    `normalize` wraps them in VecNormalize for **reward** scaling, and it matters more
    than it looks. Each episode draws a candidate whose learning rate varies by 2.6x,
    and the policy cannot observe that. So the same decisions yield very different
    returns depending on who was drawn, and the advantage estimate ends up describing
    the student rather than the action. Running reward normalisation removes most of
    that scale variation.

    Observations are left alone: they are already probabilities in [0, 1], and
    normalising them would destroy the fixed meaning of "0.25 means untested".
    """
    from stable_baselines3.common.env_util import make_vec_env
    from stable_baselines3.common.vec_env import VecNormalize

    from student_sim import InterviewEnv

    env = make_vec_env(
        lambda: InterviewEnv(questions_per_episode=questions),
        n_envs=n_envs,
        seed=seed,
    )
    if normalize:
        env = VecNormalize(env, norm_obs=False, norm_reward=True, gamma=0.98)
    return env


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timesteps", type=int, default=300_000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--n-envs", type=int, default=8)
    parser.add_argument("--questions", type=int, default=20)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    # 0.005 was too low: the first run collapsed onto "always easy" and never
    # explored the difficulty axis again. With 45 actions, exploration has to be
    # sustained rather than merely present.
    parser.add_argument("--ent-coef", type=float, default=0.02)
    parser.add_argument("--no-normalize", action="store_true")
    # Continue from a behaviour-cloned checkpoint instead of random initialisation.
    # Five from-scratch runs converged to state-independent habits without ever
    # discovering the weakest-first heuristic; warm-starting spends RL on improving
    # known-good behaviour rather than on rediscovering it. See pretrain_bc.py.
    parser.add_argument("--resume", help="path to a .zip to continue training from")
    parser.add_argument("--tag", default="ppo")
    args = parser.parse_args()

    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.callbacks import CheckpointCallback
    except ImportError:
        raise SystemExit(
            "stable-baselines3 is not installed. Run:\n"
            '  .venv/bin/pip install "stable-baselines3[extra]" matplotlib\n'
            "(~800MB, mostly torch)"
        )

    RUNS.mkdir(exist_ok=True)
    MODELS.mkdir(exist_ok=True)

    env = build_env(args.n_envs, args.seed, args.questions, normalize=not args.no_normalize)

    if args.resume:
        from sb3_compat import load_model

        # Checked explicitly: SB3 retries a missing path with a ".zip" suffix appended,
        # so the failure surfaces as `FileNotFoundError: ...zip.zip` inside twenty
        # lines of traceback, which reads like a path-handling bug rather than "the
        # file you asked for is not there".
        if not Path(args.resume).exists():
            raise SystemExit(
                f"No such checkpoint: {args.resume}\n"
                "Create it first with:\n"
                "  .venv/bin/python pretrain_bc.py --expert lookahead --seed 0"
            )

        print(f"Resuming from {args.resume}")
        # env passed here, not via set_env: the behaviour-cloning checkpoint is built
        # with one environment and fine-tuned across several.
        model = load_model(PPO, args.resume, env=env)
        # A cloned policy is already good; a large learning rate would destroy it in
        # the first few updates before the advantage estimates mean anything.
        model.learning_rate = args.learning_rate / 3
        model.ent_coef = args.ent_coef
        model.tensorboard_log = str(RUNS)
    else:
        model = PPO(
            "MlpPolicy",
            env,
            seed=args.seed,
            learning_rate=args.learning_rate,
            # 20-step episodes: 256 steps per env covers ~12 complete interviews per
            # update, so an update never learns from a fragment of a single episode.
            n_steps=256,
            batch_size=512,
            # Episodes are short and undiscounted-ish by nature - a question asked at
            # step 3 pays off by step 20 - so gamma is high but not 1.0, which would
            # make the value function harder to fit without changing the ranking.
            gamma=0.98,
            gae_lambda=0.95,
            ent_coef=args.ent_coef,
            clip_range=0.2,
            n_epochs=10,
            verbose=1,
            tensorboard_log=str(RUNS),
        )

    checkpoint = CheckpointCallback(
        save_freq=max(1, 50_000 // args.n_envs),
        save_path=str(MODELS / f"{args.tag}_checkpoints"),
        name_prefix=args.tag,
    )

    print(
        f"Training PPO for {args.timesteps:,} steps "
        f"({args.n_envs} envs, seed {args.seed}).\n"
        f"TensorBoard: .venv/bin/tensorboard --logdir {RUNS}\n"
    )
    model.learn(
        total_timesteps=args.timesteps,
        callback=checkpoint,
        tb_log_name=f"{args.tag}_seed{args.seed}",
        progress_bar=True,
    )

    destination = MODELS / f"{args.tag}_seed{args.seed}"
    model.save(destination)
    # VecNormalize keeps running statistics outside the model; without saving them
    # the policy is evaluated against a different reward scale than it trained on.
    if not args.no_normalize:
        env.save(str(MODELS / f"{args.tag}_seed{args.seed}_vecnormalize.pkl"))
    print(f"\nSaved {destination}.zip")
    print("Now compare it against the baselines:")
    print(f"  .venv/bin/python evaluate.py --model {destination}.zip")


if __name__ == "__main__":
    main()
