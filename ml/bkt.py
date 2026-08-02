"""Bayesian Knowledge Tracing (Model 2).

BKT models a learner's latent mastery of a topic as a single probability that is
updated after each observed answer. Two things happen per observation:

1. **Evidence update** - Bayes' rule on the observed correct/incorrect outcome,
   accounting for the chance the learner slipped (knew it, answered badly) or
   guessed (didn't know it, answered well).
2. **Learning transition** - the learner may transition from not-knowing to
   knowing as a result of attempting the question, with probability ``p_learn``.

This module is deliberately dependency-light (pure Python + numpy) and free of
any I/O. It is used in two places:

* offline, as the generative core of the student simulator that the RL
  curriculum controller (Model 1) trains against;
* online, ported to TypeScript, to maintain real users' knowledge state.

Keeping it pure makes both uses testable without a database or a network.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

# The action/topic taxonomy. Mirrors DEFAULT_TAGS in lib/rl/bandit.ts - the two
# must stay in sync, since the trained policy's action space is indexed by this
# ordering and the TypeScript side consumes those indices.
DEFAULT_TOPICS: tuple[str, ...] = (
    "system-design",
    "leadership",
    "conflict",
    "technical-depth",
    "behavioral",
    "product-sense",
    "metrics",
    "communication",
    "ownership",
    "problem-solving",
    "cultural-fit",
    "resume-probe",
    "gap-probe",
    "ambiguity",
    "first-principles",
)


@dataclass(frozen=True)
class BKTParams:
    """The four standard BKT parameters, per topic.

    Defaults are hand-set for the interview domain rather than inherited from
    the math-tutoring datasets BKT is usually fit on. The important deviation is
    ``p_guess``: on multiple-choice math it sits near 0.25 because a learner can
    pick randomly, but an open-ended interview answer cannot be guessed into a
    good rubric score, so it is much lower here.

    These values are assumptions. ``experiments/sensitivity.py`` sweeps them to
    show the trained policy's advantage holds across the plausible range, which
    is the claim that actually needs defending.
    """

    p_init: float = 0.25   # P(already knows the topic at session zero)
    p_learn: float = 0.12  # P(learns it by attempting a question)
    p_slip: float = 0.10   # P(answers badly | knows it)
    p_guess: float = 0.08  # P(answers well | does not know it)

    def __post_init__(self) -> None:
        for name in ("p_init", "p_learn", "p_slip", "p_guess"):
            value = getattr(self, name)
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be in [0, 1], got {value}")
        # Slip + guess >= 1 inverts the model: a correct answer would become
        # evidence *against* mastery. Standard BKT identifiability constraint.
        if self.p_slip + self.p_guess >= 1.0:
            raise ValueError(
                f"p_slip + p_guess must be < 1 (got {self.p_slip + self.p_guess:.3f}); "
                "otherwise correct answers reduce inferred mastery"
            )


def prob_correct(mastery: float, params: BKTParams) -> float:
    """P(observed correct) given current mastery.

    Marginalises over the two ways a correct answer can happen: the learner
    knows it and does not slip, or does not know it and guesses well.
    """
    return mastery * (1.0 - params.p_slip) + (1.0 - mastery) * params.p_guess


def posterior(mastery: float, correct: bool, params: BKTParams) -> float:
    """Bayes update of mastery on an observed outcome, before learning."""
    if correct:
        numerator = mastery * (1.0 - params.p_slip)
        denominator = numerator + (1.0 - mastery) * params.p_guess
    else:
        numerator = mastery * params.p_slip
        denominator = numerator + (1.0 - mastery) * (1.0 - params.p_guess)

    # Guarded for the degenerate case where the observation has zero likelihood
    # under both hypotheses; leaving mastery unchanged is the safe response.
    if denominator == 0.0:
        return mastery
    return numerator / denominator


def update(mastery: float, correct: bool, params: BKTParams) -> float:
    """One full BKT step: evidence update, then the learning transition.

    Returns the new mastery estimate. This is the single function the simulator
    and the production TypeScript port both implement.
    """
    posterior_mastery = posterior(mastery, correct, params)
    return posterior_mastery + (1.0 - posterior_mastery) * params.p_learn


def score_to_observation(score: float, threshold: float = 60.0) -> bool:
    """Collapse a 0-100 rubric score into the binary signal BKT consumes.

    This threshold is the seam between Model 3 (LLM evaluation) and Model 2, and
    it is a real modelling decision rather than an implementation detail: too
    high and every learner looks permanently incompetent, too low and mastery
    saturates after a few questions and the curriculum controller has no signal
    left to act on. 60 matches the pass mark already used in lib/scoring.
    """
    return score >= threshold


# Score difference worth roughly one logistic unit of confidence. At 15, an 85 is
# strong evidence (0.82) and a 65 is only mildly positive (0.63), which is the
# distinction the hard threshold discards. Swept in Phase 4's sensitivity analysis.
SOFTNESS: float = 15.0


def observation_confidence(
    score: float, threshold: float = 60.0, softness: float = SOFTNESS
) -> float:
    """How strongly a 0-100 rubric score argues that the candidate knows the topic.

    Returns a number in (0, 1): 1.0 means "certainly a correct answer", 0.0 means
    "certainly not", 0.5 means "the evidence is a coin flip".

    ``score_to_observation`` throws away almost everything the rubric measured - a
    61 and a 99 become the same observation, as do a 59 and a 12. That loss is what
    makes mastery saturate after two questions: every passing answer is treated as
    maximally strong evidence, so two of them are enough to push mastery from 0.08
    to 0.94, after which the curriculum controller has fifteen near-identical
    numbers to choose between and nothing to act on.

    A logistic curve centred on the pass mark keeps the same meaning at the
    threshold (60 -> 0.5) while letting the *margin* matter. ``softness`` is the
    score difference that moves confidence about one logistic unit: small values
    approach the old hard cutoff, large values flatten toward "no information".
    """
    return 1.0 / (1.0 + math.exp(-(score - threshold) / softness))


def update_soft(mastery: float, confidence: float, params: BKTParams) -> float:
    """BKT step under an *uncertain* observation.

    The expected posterior: run the update both ways and weight by how likely each
    outcome is. At confidence 1.0 or 0.0 this reduces exactly to ``update`` with
    ``correct=True``/``False``, so the hard-threshold behaviour is a special case
    rather than a separate code path - which is what makes the two comparable in
    the Phase 4 sensitivity sweep.
    """
    if not 0.0 <= confidence <= 1.0:
        raise ValueError(f"confidence must be in [0, 1], got {confidence}")
    return (
        confidence * update(mastery, True, params)
        + (1.0 - confidence) * update(mastery, False, params)
    )


@dataclass
class KnowledgeState:
    """Per-topic mastery for one learner - the 'Knowledge State vector'.

    Mirrors the ``knowledge_state`` table on the production side.
    """

    topics: tuple[str, ...] = DEFAULT_TOPICS
    params: BKTParams = field(default_factory=BKTParams)
    mastery: dict[str, float] = field(default_factory=dict)
    attempts: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.mastery:
            self.mastery = {t: self.params.p_init for t in self.topics}
        if not self.attempts:
            self.attempts = {t: 0 for t in self.topics}

    def observe(self, topic: str, correct: bool) -> float:
        """Record an outcome for ``topic``; returns the mastery gain."""
        if topic not in self.mastery:
            raise KeyError(f"unknown topic: {topic!r}")
        before = self.mastery[topic]
        after = update(before, correct, self.params)
        self.mastery[topic] = after
        self.attempts[topic] += 1
        return after - before

    def observe_score(
        self,
        topic: str,
        score: float,
        threshold: float = 60.0,
        softness: float = SOFTNESS,
    ) -> float:
        """As ``observe``, taking a raw rubric score and using *graded* evidence.

        This is the production path (see ``lib/kt/store.ts``). Pass
        ``softness=0`` for the old hard-threshold behaviour, which the baselines
        use for comparison.
        """
        if topic not in self.mastery:
            raise KeyError(f"unknown topic: {topic!r}")
        before = self.mastery[topic]
        if softness <= 0.0:
            after = update(before, score_to_observation(score, threshold), self.params)
        else:
            confidence = observation_confidence(score, threshold, softness)
            after = update_soft(before, confidence, self.params)
        self.mastery[topic] = after
        self.attempts[topic] += 1
        return after - before

    def vector(self) -> list[float]:
        """Mastery as a fixed-order list - the RL policy's observation."""
        return [self.mastery[t] for t in self.topics]

    def mean_mastery(self) -> float:
        return sum(self.mastery.values()) / len(self.mastery)

    def weakest(self, n: int = 5) -> list[str]:
        return sorted(self.topics, key=lambda t: self.mastery[t])[:n]

    def copy(self) -> "KnowledgeState":
        return KnowledgeState(
            topics=self.topics,
            params=replace(self.params),
            mastery=dict(self.mastery),
            attempts=dict(self.attempts),
        )
