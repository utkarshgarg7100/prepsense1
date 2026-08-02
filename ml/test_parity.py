"""Parity between `ml/parser.py` and the TypeScript port in `lib/parse/parser.ts`.

Two implementations of one model is a standing risk: they drift, and the drift shows
up as a subtly wrong interview focus rather than as an error. These tests pin down
what "agreement" actually means here.

They deliberately do **not** assert equal numbers. The Python side lemmatises with
spaCy; TypeScript has no equivalent and uses suffix rules plus an irregular-verb
table, so the two land on slightly different term counts and the cosine magnitudes
differ by roughly 0.2. What must agree is the *decision* the vector drives: which
topics are gaps, and which are worst. Asserting equal floats would either fail
constantly or force the Python side down to the crude stemmer, which would make the
reference implementation worse to keep a test green.
"""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from parser import TOPIC_KEYWORDS, parse
from test_parser import BACKEND_JD, BACKEND_RESUME, LEADERSHIP_JD, PM_RESUME

REPO = Path(__file__).resolve().parent.parent
LEXICON_TS = REPO / "lib" / "parse" / "parser.ts"
LEXICON_SRC = REPO / "lib" / "parse" / "lexicon.ts"

CASES = {
    "ic_vs_mgr": (BACKEND_RESUME, LEADERSHIP_JD),
    "ic_vs_backend": (BACKEND_RESUME, BACKEND_JD),
    "pm_vs_backend": (PM_RESUME, BACKEND_JD),
}

# A gap below this is indistinguishable from noise; both sides produce a scatter of
# tiny values from incidental keyword overlap, and ranking them is meaningless.
SIGNIFICANT = 0.05


# --- lexicon drift (no Node required) -------------------------------------

def test_typescript_lexicon_matches_python():
    """`lib/parse/lexicon.ts` is generated from Python and must not be hand-edited.

    This is the cheap guard that catches the most likely drift: someone adds a
    keyword on one side only.
    """
    source = LEXICON_SRC.read_text()

    for topic, keywords in TOPIC_KEYWORDS.items():
        assert f"'{topic}':" in source, f"topic {topic!r} missing from lexicon.ts"
        for keyword in keywords:
            assert f"'{keyword}'" in source, (
                f"keyword {keyword!r} (topic {topic!r}) is in ml/parser.py but not "
                "lib/parse/lexicon.ts - regenerate it"
            )

    # And nothing extra on the TypeScript side.
    ts_keywords = set(re.findall(r"'([a-z][a-z /-]*)'", source))
    py_keywords = {kw for kws in TOPIC_KEYWORDS.values() for kw in kws}
    extras = ts_keywords - py_keywords - set(TOPIC_KEYWORDS)
    assert not extras, f"lexicon.ts has keywords Python does not: {sorted(extras)}"


def test_prior_band_matches_python():
    from parser import PRIOR_CEILING, PRIOR_FLOOR

    source = LEXICON_SRC.read_text()
    assert f"PRIOR_FLOOR = {PRIOR_FLOOR}" in source
    assert f"PRIOR_CEILING = {PRIOR_CEILING}" in source


# --- numeric parity (requires Node) ---------------------------------------

def _run_typescript() -> dict:
    """Run the TypeScript parser over the shared fixtures and return its output."""
    npx = shutil.which("npx")
    if npx is None:
        pytest.skip("Node/npx not available")

    script = REPO / ".tmp-parity" / "parity.mts"
    script.parent.mkdir(exist_ok=True)
    fixtures = {name: [r, j] for name, (r, j) in CASES.items()}
    script.write_text(
        "import { parseResumeAndJD, gapVector, weakestTopics } "
        "from '../lib/parse/parser.ts'\n"
        f"const cases = {json.dumps(fixtures)}\n"
        "const out: any = {}\n"
        "for (const [name, [r, j]] of Object.entries(cases)) {\n"
        "  const res = parseResumeAndJD(r as string, j as string)\n"
        "  out[name] = { gaps: gapVector(res), weakest: weakestTopics(res, 5) }\n"
        "}\n"
        "console.log(JSON.stringify(out))\n"
    )
    proc = subprocess.run(
        [npx, "tsx", str(script)], cwd=REPO, capture_output=True, text=True, timeout=180
    )
    if proc.returncode != 0:
        pytest.skip(f"TypeScript parser could not run: {proc.stderr[-400:]}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def ts_output() -> dict:
    return _run_typescript()


@pytest.mark.parametrize("case", sorted(CASES))
def test_same_topics_are_flagged_as_gaps(case, ts_output):
    resume, jd = CASES[case]
    py = parse(resume, jd)
    py_gaps = {t for t in py.topics if py.gaps[t] >= SIGNIFICANT}
    ts_gaps = {
        t for t, v in zip(py.topics, ts_output[case]["gaps"]) if v >= SIGNIFICANT
    }
    assert py_gaps == ts_gaps, (
        f"{case}: Python flags {sorted(py_gaps)}, TypeScript flags {sorted(ts_gaps)}"
    )


@pytest.mark.parametrize("case", sorted(CASES))
def test_the_worst_gap_is_the_same_topic(case, ts_output):
    """The single most important output: what the interview opens on."""
    resume, jd = CASES[case]
    py = parse(resume, jd)
    ts_gaps = dict(zip(py.topics, ts_output[case]["gaps"]))
    assert py.weakest(1)[0] == max(ts_gaps, key=lambda t: ts_gaps[t])


@pytest.mark.parametrize("case", sorted(CASES))
def test_significant_gaps_rank_in_the_same_order(case, ts_output):
    resume, jd = CASES[case]
    py = parse(resume, jd)
    ts_gaps = dict(zip(py.topics, ts_output[case]["gaps"]))

    py_ranked = [t for t in py.weakest(len(py.topics)) if py.gaps[t] >= SIGNIFICANT]
    ts_ranked = [
        t for t in sorted(ts_gaps, key=lambda x: -ts_gaps[x])
        if ts_gaps[t] >= SIGNIFICANT
    ]
    assert py_ranked == ts_ranked


@pytest.mark.parametrize("case", sorted(CASES))
def test_vector_shape_matches(case, ts_output):
    resume, jd = CASES[case]
    py = parse(resume, jd)
    ts_vector = ts_output[case]["gaps"]
    assert len(ts_vector) == len(py.vector())
    assert all(0.0 <= v <= 1.0 for v in ts_vector)
