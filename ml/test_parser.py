"""Tests for the resume/JD parser (Model 5).

Two kinds of test here. Most assert *relative* claims - this topic scores above
that one for this document - because the absolute cosine values shift whenever the
lexicons are edited, and tests pinned to exact numbers would then fail for no real
reason. The rest assert the output-shape invariants, which must hold for any input
at all, including garbage, because everything downstream indexes the vector
positionally.
"""

import pytest

from bkt import DEFAULT_TOPICS, BKTParams, KnowledgeState
from parser import (
    PRIOR_CEILING,
    PRIOR_FLOOR,
    TOPIC_KEYWORDS,
    ParseResult,
    normalise,
    parse,
)

# --- fixtures: realistic documents ---------------------------------------

BACKEND_RESUME = """
Senior Backend Engineer, 6 years experience.
Designed and shipped a distributed order-processing system handling 40k requests
per second. Introduced caching and sharding to cut p99 latency from 800ms to 90ms.
Profiled and optimised hot paths in the matching algorithm; refactored the legacy
codebase and raised test coverage. Debugged production incidents and wrote the
root cause analysis documents.
"""

LEADERSHIP_JD = """
Engineering Manager. You will lead and mentor a team of eight engineers, run
hiring and onboarding, and manage stakeholder relationships across product and
design. You will coach direct reports, resolve conflict and disagreement within
the team, negotiate priorities, and align cross functional partners toward
consensus. Strong communication and presentation skills required.
"""

BACKEND_JD = """
Backend Engineer. Build scalable distributed systems and microservices. You will
work on caching, sharding, load balancing, and high availability infrastructure,
optimising throughput and latency. Strong algorithm and data structure knowledge
required; you will debug and profile production systems.
"""

PM_RESUME = """
Product Manager, 4 years. Owned the roadmap for a customer-facing checkout
product. Ran user research and usability studies, built personas, and prioritised
features by measured impact. Drove A/B tests, tracked conversion and retention
metrics on the analytics dashboard, and reported ROI to stakeholders.
"""


# --- normalisation --------------------------------------------------------

def test_normalise_lemmatises_and_drops_stopwords():
    out = normalise("She was leading the teams and managing stakeholders.")
    assert "lead" in out
    assert "manage" in out
    # Stop words must be gone, otherwise they dominate TF and swamp real signal.
    assert " the " not in f" {out} "
    assert " was " not in f" {out} "


def test_normalise_preserves_multiword_phrases_as_single_tokens():
    # "system design" must survive as one term; split apart, "design" alone would
    # also match the design-adjacent keywords of unrelated topics.
    out = normalise("Experience with system design and root cause analysis.")
    assert "system_design" in out
    assert "root_cause" in out


def test_normalise_substitutes_longer_phrases_first():
    # "user research" must be consumed whole rather than leaving a bare "user".
    out = normalise("Conducted user research sessions.")
    assert "user_research" in out


def test_normalise_handles_empty_input():
    assert normalise("") == ""
    assert normalise("   \n  ") == ""


# --- topic discrimination -------------------------------------------------

def test_leadership_jd_demands_leadership_over_system_design():
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    assert result.demand["leadership"] > result.demand["system-design"]


def test_backend_resume_evidences_system_design_over_leadership():
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    assert result.evidence["system-design"] > result.evidence["leadership"]


def test_gap_appears_where_jd_demands_what_resume_lacks():
    # The canonical case this model exists to catch: a strong IC applying to a
    # management role should be interviewed hardest on leadership and conflict.
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    assert result.gaps["leadership"] > 0.0
    assert result.gaps["leadership"] > result.gaps["technical-depth"]
    assert "leadership" in result.weakest(5)


def test_matching_jd_produces_smaller_gaps_than_a_mismatched_one():
    # The comparison has to be the same candidate across two jobs. Comparing two
    # topics within one JD says nothing: a topic the JD never mentions has zero
    # demand and therefore zero gap, which looks like a strength but is really an
    # absence.
    matched = parse(BACKEND_RESUME, BACKEND_JD)
    mismatched = parse(BACKEND_RESUME, LEADERSHIP_JD)
    assert max(matched.vector()) < max(mismatched.vector())
    # And no single topic should look like a severe gap for a well-matched CV.
    assert max(matched.vector()) < 0.5


def test_the_top_demanded_topic_retains_a_residual_gap():
    # Documented limitation of self-normalising each profile: exactly one topic per
    # document scores 1.0, so the JD's top topic shows a gap unless it is also the
    # CV's top topic. Pinned here so that if the normalisation is ever changed, the
    # change is deliberate rather than accidental.
    matched = parse(BACKEND_RESUME, BACKEND_JD)
    assert matched.demand["system-design"] == pytest.approx(1.0)
    assert 0.0 < matched.gaps["system-design"] < 0.5


def test_different_resumes_produce_different_profiles():
    backend = parse(BACKEND_RESUME, BACKEND_JD)
    pm = parse(PM_RESUME, BACKEND_JD)
    assert backend.vector() != pm.vector()
    assert pm.evidence["metrics"] > pm.evidence["system-design"]


def test_parse_is_deterministic():
    # The BKT parity tests and any cached priors depend on this.
    first = parse(BACKEND_RESUME, LEADERSHIP_JD)
    second = parse(BACKEND_RESUME, LEADERSHIP_JD)
    assert first.vector() == second.vector()


# --- output invariants (the Phase 1 bug guard) ----------------------------

@pytest.mark.parametrize(
    "resume,jd",
    [
        (BACKEND_RESUME, LEADERSHIP_JD),
        ("", ""),
        ("", LEADERSHIP_JD),
        (BACKEND_RESUME, ""),
        ("...", "!!!"),
        ("42 42 42", "1234567890"),
        ("\n\t  \n", "   "),
        ("qqqq zzzz xxxx", "wwww vvvv"),  # real words, no lexicon overlap
        ("a" * 5000, "b" * 5000),
    ],
)
def test_vector_shape_and_range_hold_for_any_input(resume, jd):
    result = parse(resume, jd)
    vector = result.vector()
    assert len(vector) == len(DEFAULT_TOPICS)
    assert all(0.0 <= v <= 1.0 for v in vector)
    # Every topic present in every dict, so callers can index without checking.
    for values in (result.demand, result.evidence, result.gaps):
        assert set(values) == set(DEFAULT_TOPICS)


def test_empty_documents_produce_an_all_zero_gap_vector():
    result = parse("", "")
    assert result.vector() == [0.0] * len(DEFAULT_TOPICS)


def test_unmatched_vocabulary_produces_no_gaps():
    # Text that matches no lexicon at all must not manufacture confident gaps.
    result = parse("qqqq zzzz", "wwww vvvv")
    assert all(g == 0.0 for g in result.vector())


def test_vector_order_matches_topic_order():
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    assert result.vector() == [result.gaps[t] for t in DEFAULT_TOPICS]


def test_rejects_topic_without_a_lexicon():
    with pytest.raises(KeyError, match="no keyword lexicon"):
        parse(BACKEND_RESUME, LEADERSHIP_JD, topics=("system-design", "made-up-topic"))


def test_every_default_topic_has_a_lexicon():
    # Guards against adding a topic to bkt.DEFAULT_TOPICS and forgetting the
    # lexicon here, which would break every parse rather than one topic.
    assert set(DEFAULT_TOPICS) == set(TOPIC_KEYWORDS)
    assert all(TOPIC_KEYWORDS[t] for t in DEFAULT_TOPICS)


# --- BKT priors -----------------------------------------------------------

def test_priors_stay_within_the_declared_band():
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    priors = result.priors()
    assert set(priors) == set(DEFAULT_TOPICS)
    assert all(PRIOR_FLOOR <= p <= PRIOR_CEILING for p in priors.values())


def test_larger_gap_yields_lower_prior():
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    priors = result.priors()
    ranked = sorted(DEFAULT_TOPICS, key=lambda t: result.gaps[t])
    lowest_gap, highest_gap = ranked[0], ranked[-1]
    assert priors[highest_gap] < priors[lowest_gap]


def test_zero_gap_everywhere_leaves_priors_at_the_default():
    result = parse("", "")
    params = BKTParams()
    priors = result.priors(params)
    assert all(p == pytest.approx(params.p_init) for p in priors.values())


def test_priors_are_a_valid_knowledge_state_seed():
    # The integration contract with Model 2: parser output must drop straight into
    # KnowledgeState without reshaping.
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    state = KnowledgeState(mastery=result.priors())
    assert len(state.vector()) == len(DEFAULT_TOPICS)
    assert state.observe("leadership", correct=True) > 0.0


def test_weak_topics_from_the_parser_start_below_the_strong_ones():
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    state = KnowledgeState(mastery=result.priors())
    assert state.mastery["leadership"] < state.mastery["technical-depth"]


# --- explainability -------------------------------------------------------

def test_explain_names_the_matched_terms():
    result = parse(BACKEND_RESUME, LEADERSHIP_JD)
    explanation = result.explain("leadership")
    assert "leadership" in explanation
    assert "gap=" in explanation


def test_explain_is_honest_when_nothing_matched():
    result = parse("qqqq", "zzzz")
    assert "no keywords matched" in result.explain("leadership")
