"""The Phase 4 results figure.

    .venv/bin/python evaluate.py --model models/ppo_seed0.zip --json results.json
    .venv/bin/python plot_results.py --results results.json

Two panels: policy comparison with error bars, and the sensitivity sweep. The oracle
is drawn as a dashed ceiling rather than as another bar, because it cheats - showing
it as a competitor invites the reader to treat the gap as failure rather than as the
information limit it actually is.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", default="results.json")
    parser.add_argument("--sensitivity", default="sensitivity.json")
    parser.add_argument("--out", default="results.png")
    args = parser.parse_args()

    try:
        import matplotlib.pyplot as plt
    except ImportError:
        raise SystemExit("matplotlib is not installed: .venv/bin/pip install matplotlib")

    results = json.loads(Path(args.results).read_text())
    has_sensitivity = Path(args.sensitivity).exists()

    fig, axes = plt.subplots(1, 2 if has_sensitivity else 1, figsize=(12 if has_sensitivity else 6, 4.5))
    axes = axes if has_sensitivity else [axes]

    oracle = results.pop("oracle", None)
    names = list(results)
    means = [results[n]["mean"] for n in names]
    errors = [results[n]["stderr"] for n in names]
    # The trained policy is the claim; everything else is context.
    colours = ["#2563eb" if n.endswith("trained") else "#94a3b8" for n in names]

    ax = axes[0]
    ax.bar(names, means, yerr=errors, capsize=4, color=colours)
    if oracle:
        ax.axhline(oracle["mean"], linestyle="--", color="#dc2626", linewidth=1)
        ax.text(
            len(names) - 0.5, oracle["mean"],
            "  oracle (sees hidden state)",
            va="bottom", ha="right", fontsize=8, color="#dc2626",
        )
    ax.set_ylabel("mean true mastery gain per interview")
    ax.set_title("Curriculum policy vs baselines")
    ax.tick_params(axis="x", rotation=20)

    if has_sensitivity:
        sensitivity = json.loads(Path(args.sensitivity).read_text())
        ax = axes[1]
        for parameter, cells in sensitivity.items():
            ax.plot(
                range(len(cells)),
                [c["advantage"] for c in cells],
                marker="o",
                label=parameter,
            )
        ax.axhline(0, color="#dc2626", linewidth=1)
        ax.set_ylabel("advantage over weakest-first")
        ax.set_xlabel("parameter value (low → high)")
        ax.set_title("Robustness to the hand-set BKT parameters")
        ax.legend(fontsize=8)

    fig.tight_layout()
    fig.savefig(args.out, dpi=160)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
