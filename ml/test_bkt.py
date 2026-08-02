"""Tests for the BKT model.

These assert mathematical properties rather than golden numbers wherever
possible, so they keep their meaning if the default parameters are retuned.
"""

import pytest

from bkt import (
    DEFAULT_TOPICS,
    BKTParams,
    KnowledgeState,
    posterior,
    prob_correct,
    score_to_observation,
    observation_confidence,
    update_soft,
    update,
)


# --- parameter validation -------------------------------------------------

def test_rejects_out_of_range_parameters():
    with pytest.raises(ValueError, match="p_slip"):
        BKTParams(p_slip=1.5)
    with pytest.raises(ValueError, match="p_init"):
        BKTParams(p_init=-0.1)


def test_rejects_non_identifiable_slip_guess_combination():
    # slip + guess >= 1 inverts the evidence; must be caught at construction.
    with pytest.raises(ValueError, match="p_slip \\+ p_guess"):
        BKTParams(p_slip=0.6, p_guess=0.5)


# --- prob_correct ---------------------------------------------------------

def test_prob_correct_is_bounded_by_guess_and_slip():
    p = BKTParams()
    # A learner with zero mastery can only guess; a certain one can only slip.
    assert prob_correct(0.0, p) == pytest.approx(p.p_guess)
    assert prob_correct(1.0, p) == pytest.approx(1.0 - p.p_slip)


def test_prob_correct_increases_with_mastery():
    p = BKTParams()
    values = [prob_correct(m / 20, p) for m in range(21)]
    assert all(b > a for a, b in zip(values, values[1:]))


# --- posterior ------------------------------------------------------------

def test_correct_answer_raises_posterior_and_incorrect_lowers_it():
    p = BKTParams()
    prior = 0.4
    assert posterior(prior, True, p) > prior
    assert posterior(prior, False, p) < prior


def test_posterior_matches_hand_computed_value():
    # Deliberately explicit: catches an inverted numerator/denominator that
    # property tests alone would let through.
    p = BKTParams(p_slip=0.1, p_guess=0.2)
    # P(L|correct) = 0.5*0.9 / (0.5*0.9 + 0.5*0.2) = 0.45 / 0.55
    assert posterior(0.5, True, p) == pytest.approx(0.45 / 0.55)
    # P(L|incorrect) = 0.5*0.1 / (0.5*0.1 + 0.5*0.8) = 0.05 / 0.45
    assert posterior(0.5, False, p) == pytest.approx(0.05 / 0.45)


# --- update ---------------------------------------------------------------

def test_correct_answers_always_leave_mastery_higher_than_incorrect_ones():
    p = BKTParams()
    for prior in [0.0, 0.05, 0.3, 0.5, 0.8, 0.99, 1.0]:
        assert update(prior, True, p) >= update(prior, False, p)


def test_mastery_stays_in_unit_interval_under_any_sequence():
    p = BKTParams()
    for pattern in ([True] * 50, [False] * 50, [True, False] * 25):
        m = p.p_init
        for correct in pattern:
            m = update(m, correct, p)
            assert 0.0 <= m <= 1.0


def test_repeated_success_saturates_toward_full_mastery():
    p = BKTParams()
    m = p.p_init
    for _ in range(30):
        m = update(m, True, p)
    assert m > 0.95


def test_learning_transition_means_failure_alone_cannot_drive_mastery_to_zero():
    # p_learn > 0, so even a failing learner retains some probability of having
    # learned from the attempt. Mastery should decay but stay strictly positive.
    p = BKTParams()
    m = p.p_init
    for _ in range(30):
        m = update(m, False, p)
    assert 0.0 < m < p.p_init


def test_zero_learn_rate_freezes_learning_from_attempts():
    p = BKTParams(p_learn=0.0)
    assert update(0.5, True, p) == pytest.approx(posterior(0.5, True, p))


# --- score thresholding ---------------------------------------------------

def test_score_to_observation_thresholds_at_the_pass_mark():
    assert score_to_observation(85.0) is True
    assert score_to_observation(60.0) is True   # boundary is inclusive
    assert score_to_observation(59.9) is False
    assert score_to_observation(0.0) is False


# --- KnowledgeState -------------------------------------------------------

def test_state_initialises_every_topic_at_the_prior():
    s = KnowledgeState()
    assert len(s.mastery) == len(DEFAULT_TOPICS)
    assert all(v == s.params.p_init for v in s.mastery.values())
    assert s.vector() == [s.params.p_init] * len(DEFAULT_TOPICS)


def test_observe_returns_the_mastery_gain_and_counts_the_attempt():
    s = KnowledgeState()
    gain = s.observe("leadership", correct=True)
    assert gain > 0
    assert s.mastery["leadership"] == pytest.approx(s.params.p_init + gain)
    assert s.attempts["leadership"] == 1
    # Other topics must be untouched - mastery is per-topic, not shared.
    assert s.mastery["metrics"] == s.params.p_init


def test_observe_rejects_unknown_topics():
    with pytest.raises(KeyError):
        KnowledgeState().observe("underwater-basket-weaving", correct=True)


def test_weakest_surfaces_the_lowest_mastery_topics():
    s = KnowledgeState()
    for _ in range(10):
        s.observe("metrics", correct=True)
        s.observe("conflict", correct=False)
    weakest = s.weakest(3)
    assert "conflict" in weakest
    assert "metrics" not in weakest


def test_vector_order_is_stable_and_matches_the_topic_taxonomy():
    # The policy's action space is indexed by this ordering, so a reordering
    # would silently mis-map every trained action.
    s = KnowledgeState()
    s.observe(DEFAULT_TOPICS[0], correct=True)
    assert s.vector()[0] == s.mastery[DEFAULT_TOPICS[0]]


def test_copy_is_deep_enough_to_isolate_rollouts():
    # The simulator branches states during rollouts; aliasing here would
    # corrupt training data in ways that are very hard to trace.
    s = KnowledgeState()
    clone = s.copy()
    clone.observe("leadership", correct=True)
    assert s.mastery["leadership"] == s.params.p_init
    assert s.attempts["leadership"] == 0


# --- graded evidence (Option B: use the score, not just pass/fail) ---------

def test_confidence_is_a_half_at_the_pass_mark():
    assert observation_confidence(60.0) == pytest.approx(0.5)


def test_confidence_rises_monotonically_with_score():
    scores = [0.0, 20.0, 40.0, 59.0, 60.0, 61.0, 80.0, 100.0]
    confidences = [observation_confidence(s) for s in scores]
    assert confidences == sorted(confidences)
    assert all(0.0 < c < 1.0 for c in confidences)


def test_a_borderline_pass_is_much_weaker_evidence_than_an_excellent_answer():
    # The whole point of the change: the hard threshold treated these as identical.
    assert observation_confidence(95.0) - observation_confidence(61.0) > 0.25


def test_graded_updates_do_not_saturate_after_two_answers():
    """The failure this replaced: two passing answers took mastery 0.08 -> 0.94,
    flattening the scorecard the curriculum controller has to choose from."""
    params = BKTParams()
    mastery = 0.08
    for score in (82.0, 76.0):
        mastery = update_soft(mastery, observation_confidence(score), params)
    assert mastery < 0.85

    hard = 0.08
    for score in (82.0, 76.0):
        hard = update(hard, score_to_observation(score), params)
    assert hard > 0.9          # the old behaviour, pinned for the comparison
    assert mastery < hard


def test_a_barely_passing_answer_does_not_advance_a_confident_learner():
    # Scoring 62 when the model already believes you are strong is not evidence of
    # further mastery; it should hold roughly steady rather than climbing.
    params = BKTParams()
    after = update_soft(0.75, observation_confidence(62.0), params)
    assert after < 0.85


def test_a_bad_answer_still_lowers_mastery():
    params = BKTParams()
    assert update_soft(0.80, observation_confidence(15.0), params) < 0.80


def test_update_soft_rejects_confidence_outside_the_unit_interval():
    params = BKTParams()
    for bad in (-0.1, 1.1):
        with pytest.raises(ValueError, match="confidence"):
            update_soft(0.5, bad, params)


def test_observe_score_uses_graded_evidence_by_default():
    state = KnowledgeState()
    excellent = KnowledgeState()
    state.observe_score("leadership", 62.0)
    excellent.observe_score("leadership", 98.0)
    assert excellent.mastery["leadership"] > state.mastery["leadership"]


def test_observe_score_with_zero_softness_restores_the_hard_threshold():
    graded = KnowledgeState()
    hard = KnowledgeState()
    graded.observe_score("leadership", 62.0)
    hard.observe_score("leadership", 62.0, softness=0.0)
    assert hard.mastery["leadership"] > graded.mastery["leadership"]
