"""Train and evaluate across several seeds, then report the aggregate (Phase 4).

    .venv/bin/python run_seeds.py --seeds 0 1 2 --timesteps 1500000 --tag ppo_v4

**Why this exists.** Every result so far comes from a single training seed, and a
reviewer's first question about a single-seed RL result is whether it was a lucky
initialisation. Deep RL is notoriously seed-sensitive: the spread between seeds is
often larger than the difference between algorithms being compared.

So the reported claim should be the mean over seeds with its spread, not the best run.
This script makes that the default rather than an afterthought, and prints the
per-seed numbers so an unusually good or bad seed is visible rather than averaged
into invisibility.

It shells out to `train_ppo.py` rather than importing it, so the exact command behind
every published number is reproducible by hand.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PYTHON = sys.executable


def train(seed: int, timesteps: int, ent_coef: float, tag: str) -> Path:
    destination = HERE / "models" / f"{tag}_seed{seed}.zip"
    if destination.exists():
        print(f"  seed {seed}: already trained, skipping ({destination.name})")
        return destination

    print(f"  seed {seed}: training {timesteps:,} steps...")
    subprocess.run(
        [
            PYTHON, str(HERE / "train_ppo.py"),
            "--timesteps", str(timesteps),
            "--seed", str(seed),
            "--ent-coef", str(ent_coef),
            "--tag", tag,
        ],
        cwd=HERE,
        check=True,
    )
    return destination


def evaluate(model: Path, episodes: int) -> dict:
    output = HERE / f".seed_eval_{model.stem}.json"
    subprocess.run(
        [
            PYTHON, str(HERE / "evaluate.py"),
            "--model", str(model),
            "--episodes", str(episodes),
            "--json", str(output),
        ],
        cwd=HERE,
        check=True,
        capture_output=True,
    )
    data = json.loads(output.read_text())
    output.unlink()
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    parser.add_argument("--timesteps", type=int, default=1_500_000)
    parser.add_argument("--ent-coef", type=float, default=0.02)
    parser.add_argument("--episodes", type=int, default=500)
    parser.add_argument("--tag", default="ppo_v4")
    parser.add_argument("--json", default="results_seeds.json")
    args = parser.parse_args()

    print(f"Training {len(args.seeds)} seeds, {args.timesteps:,} steps each.\n")
    results = []
    for seed in args.seeds:
        model = train(seed, args.timesteps, args.ent_coef, args.tag)
        results.append(evaluate(model, args.episodes))

    trained_key = next(k for k in results[0] if k.endswith("trained"))
    trained = np.array([r[trained_key]["mean"] for r in results])
    greedy = np.array([r["weakest-first"]["mean"] for r in results])
    planner = np.array([r["lookahead-oracle"]["mean"] for r in results])

    print("\n" + "=" * 58)
    print(f"{'seed':<8}{'trained':>12}{'weakest':>12}{'advantage':>14}")
    print("-" * 58)
    for seed, t, g in zip(args.seeds, trained, greedy):
        print(f"{seed:<8}{t:>12.4f}{g:>12.4f}{100*(t-g)/g:>13.1f}%")
    print("-" * 58)

    # Baselines are deterministic given the evaluation seeds, so their spread across
    # runs is zero; only the trained policy varies. Report its spread explicitly.
    print(f"{'mean':<8}{trained.mean():>12.4f}{greedy.mean():>12.4f}"
          f"{100*(trained.mean()-greedy.mean())/greedy.mean():>13.1f}%")
    print(f"{'sd':<8}{trained.std(ddof=1):>12.4f}")
    print(f"\nCeiling (lookahead-oracle): {planner.mean():.4f}")

    spread = trained.max() - trained.min()
    advantage = trained.mean() - greedy.mean()
    if spread > abs(advantage):
        print(
            f"\n⚠️  Seed spread ({spread:.4f}) exceeds the advantage over weakest-first "
            f"({advantage:+.4f}).\n"
            "    Do not report the best seed as the result - the difference between\n"
            "    seeds is larger than the effect being claimed. Run more seeds."
        )

    Path(args.json).write_text(
        json.dumps(
            {
                "seeds": args.seeds,
                "trained": trained.tolist(),
                "weakest_first": greedy.tolist(),
                "lookahead_oracle": planner.tolist(),
                "trained_mean": float(trained.mean()),
                "trained_sd": float(trained.std(ddof=1)),
                "advantage_percent": float(100 * (trained.mean() - greedy.mean()) / greedy.mean()),
            },
            indent=2,
        )
    )
    print(f"\nWrote {args.json}")


if __name__ == "__main__":
    main()
