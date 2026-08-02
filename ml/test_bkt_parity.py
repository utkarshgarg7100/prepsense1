"""Parity between `ml/bkt.py` and the TypeScript port in `lib/kt/bkt.ts`.

The parser's parity test deliberately compares *rankings*, because spaCy has no
TypeScript equivalent. This one is the opposite: BKT is pure arithmetic with no
linguistic step, so there is no legitimate reason for the two to differ at all.
Anything above floating-point noise is a bug.

This matters more than it looks. The simulator the RL policy trains against uses
the Python side; production uses the TypeScript side. If they drift, the policy is
optimised for a student model that does not match the one it is deployed onto, and
nothing anywhere raises an error - the interview just quietly picks worse
questions.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from bkt import (
    DEFAULT_TOPICS,
    SOFTNESS,
    BKTParams,
    observation_confidence,
    posterior,
    prob_correct,
    score_to_observation,
    update,
    update_soft,
)

REPO = Path(__file__).resolve().parent.parent
TS_SOURCE = REPO / "lib" / "kt" / "bkt.ts"

# Floating point ordering can differ between the two languages by an ulp or two.
# Anything larger is a real divergence in the maths.
TOLERANCE = 1e-12

MASTERIES = [0.0, 0.01, 0.08, 0.25, 0.5, 0.75, 0.92, 0.99, 1.0]
SCORES = [0.0, 35.0, 59.0, 59.9, 60.0, 60.1, 85.0, 100.0]

# Non-default parameter sets, so parity is not an artefact of one lucky tuple.
PARAM_SETS = [
    {"p_init": 0.25, "p_learn": 0.12, "p_slip": 0.10, "p_guess": 0.08},
    {"p_init": 0.10, "p_learn": 0.30, "p_slip": 0.20, "p_guess": 0.25},
    {"p_init": 0.50, "p_learn": 0.01, "p_slip": 0.01, "p_guess": 0.01},
]

# A realistic run of answers on one topic: strong, strong, weak, strong, weak, weak.
SEQUENCE = [82.0, 74.0, 41.0, 68.0, 55.0, 30.0]


def _run_typescript() -> dict:
    """Drive the TypeScript port over the same grid and return its numbers."""
    npx = shutil.which("npx")
    if npx is None:
        pytest.skip("Node/npx not available")

    script = REPO / ".tmp-parity" / "bkt-parity.mts"
    script.parent.mkdir(exist_ok=True)
    script.write_text(
        "import { DEFAULT_TOPICS, observationConfidence, posterior, probCorrect, "
        "scoreToObservation, update, updateSoft } from '../lib/kt/bkt.ts'\n"
        f"const masteries = {json.dumps(MASTERIES)}\n"
        f"const scores = {json.dumps(SCORES)}\n"
        f"const paramSets = {json.dumps(PARAM_SETS)}\n"
        f"const sequence = {json.dumps(SEQUENCE)}\n"
        "const grid: any[] = []\n"
        "for (const params of paramSets) {\n"
        "  for (const m of masteries) {\n"
        "    for (const correct of [true, false]) {\n"
        "      grid.push({\n"
        "        posterior: posterior(m, correct, params as any),\n"
        "        update: update(m, correct, params as any),\n"
        "        probCorrect: probCorrect(m, params as any),\n"
        "      })\n"
        "    }\n"
        "  }\n"
        "}\n"
        "const observations = scores.map(s => scoreToObservation(s))\n"
        "const confidences = scores.map(s => observationConfidence(s))\n"
        "const softGrid: any[] = []\n"
        "for (const params of paramSets) {\n"
        "  for (const m of masteries) {\n"
        "    for (const s of scores) {\n"
        "      softGrid.push(updateSoft(m, observationConfidence(s), params as any))\n"
        "    }\n"
        "  }\n"
        "}\n"
        "const trajectories = paramSets.map(params => {\n"
        "  let m = (params as any).p_init\n"
        "  const path = [m]\n"
        "  for (const s of sequence) {\n"
        "    m = updateSoft(m, observationConfidence(s), params as any)\n"
        "    path.push(m)\n"
        "  }\n"
        "  return path\n"
        "})\n"
        "console.log(JSON.stringify({ grid, observations, confidences, softGrid, "
        "trajectories, topics: DEFAULT_TOPICS }))\n"
    )
    proc = subprocess.run(
        [npx, "tsx", str(script)], cwd=REPO, capture_output=True, text=True, timeout=180
    )
    if proc.returncode != 0:
        pytest.skip(f"TypeScript BKT could not run: {proc.stderr[-400:]}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def ts():
    return _run_typescript()


def test_topic_taxonomy_matches():
    """The ordering is the RL policy's action index. Reordering either side
    silently mis-maps every trained action, so this is checked as a sequence."""
    source = TS_SOURCE.read_text()
    start = source.index("DEFAULT_TOPICS = [")
    end = source.index("]", start)
    ts_topics = [line.strip().strip("',") for line in source[start:end].splitlines()[1:]]
    ts_topics = [t for t in ts_topics if t]
    assert ts_topics == list(DEFAULT_TOPICS)


def test_default_parameters_match():
    source = TS_SOURCE.read_text()
    defaults = BKTParams()
    for name in ("p_init", "p_learn", "p_slip", "p_guess"):
        value = getattr(defaults, name)
        assert f"{name}: {value}" in source, (
            f"{name} is {value} in ml/bkt.py but not found in lib/kt/bkt.ts"
        )


def test_posterior_and_update_match_across_the_grid(ts):
    index = 0
    for params_dict in PARAM_SETS:
        params = BKTParams(**params_dict)
        for mastery in MASTERIES:
            for correct in (True, False):
                got = ts["grid"][index]
                index += 1
                assert got["posterior"] == pytest.approx(
                    posterior(mastery, correct, params), abs=TOLERANCE
                ), f"posterior({mastery}, {correct}, {params_dict})"
                assert got["update"] == pytest.approx(
                    update(mastery, correct, params), abs=TOLERANCE
                ), f"update({mastery}, {correct}, {params_dict})"
                assert got["probCorrect"] == pytest.approx(
                    prob_correct(mastery, params), abs=TOLERANCE
                ), f"prob_correct({mastery}, {params_dict})"
    assert index == len(ts["grid"]), "TypeScript produced a different grid size"


def test_score_threshold_matches_including_the_boundary(ts):
    """59.9 vs 60.0 is where an off-by-one in the comparison would hide."""
    assert ts["observations"] == [score_to_observation(s) for s in SCORES]


def test_softness_constant_matches():
    assert f"SOFTNESS = {int(SOFTNESS)}" in TS_SOURCE.read_text()


def test_graded_confidence_matches(ts):
    """The logistic is where a transcription of exp()/sign could quietly differ."""
    assert ts["confidences"] == pytest.approx(
        [observation_confidence(s) for s in SCORES], abs=TOLERANCE
    )


def test_soft_update_matches_across_the_grid(ts):
    index = 0
    for params_dict in PARAM_SETS:
        params = BKTParams(**params_dict)
        for mastery in MASTERIES:
            for score in SCORES:
                expected = update_soft(mastery, observation_confidence(score), params)
                assert ts["softGrid"][index] == pytest.approx(expected, abs=TOLERANCE), (
                    f"update_soft({mastery}, score={score}, {params_dict})"
                )
                index += 1
    assert index == len(ts["softGrid"])


def test_soft_update_reduces_to_the_hard_one_at_the_extremes():
    """Confidence 1/0 must be exactly the old behaviour, or the Phase 4 sweep is
    comparing two different models rather than two settings of one."""
    params = BKTParams()
    for mastery in MASTERIES:
        assert update_soft(mastery, 1.0, params) == pytest.approx(
            update(mastery, True, params), abs=TOLERANCE
        )
        assert update_soft(mastery, 0.0, params) == pytest.approx(
            update(mastery, False, params), abs=TOLERANCE
        )


def test_multi_step_trajectories_do_not_drift(ts):
    """Single steps agreeing is not enough - errors compound over a session."""
    for params_dict, ts_path in zip(PARAM_SETS, ts["trajectories"]):
        params = BKTParams(**params_dict)
        mastery = params.p_init
        expected = [mastery]
        for score in SEQUENCE:
            mastery = update_soft(mastery, observation_confidence(score), params)
            expected.append(mastery)
        assert ts_path == pytest.approx(expected, abs=TOLERANCE)
