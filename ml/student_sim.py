"""Simulated interview candidate (Phase 3) - the environment Model 1 trains in.

The RL curriculum controller needs 10^4-10^5 episodes. Real usage will produce
perhaps fifty. So the policy learns against a *generative* student built from the
same BKT model that runs in production, and never against live users.

The whole project's central claim rests on this file being right, so the design
decisions are spelled out rather than left implicit.

**Two levels of state, deliberately.**

* ``true_mastery`` - what the candidate actually knows. Hidden. Drives whether they
  answer well and how much they learn.
* ``KnowledgeState`` (BKT) - what the *system believes*, updated from observed
  scores exactly as ``lib/kt/store.ts`` does in production.

The policy observes only the second. That is not a simplification, it is the point:
in production there is no oracle, so a policy trained on true mastery would be
learning from information it will never have at inference time. The reward, by
contrast, is computed on true mastery - we grade the policy on what the candidate
really learned, not on what the system managed to convince itself of.

**Why the task is non-trivial.** Two dynamics, and the second was added only after
measurement showed the first was not enough.

1. *Zone of proximal development.* A question far below the candidate's level teaches
   nothing, and one far above teaches nothing either, so difficulty has to be matched
   to an ability that is only known noisily.

2. *Morale.* A run of failures depresses both how well the candidate answers and how
   much they absorb. Recovering it costs a question spent where they are strong -
   little learning now, more learning later.

The first alone did **not** produce a task worth learning. Measured properly, the best
greedy policy limited to the observation scored 0.1274 against weakest-first's 0.1263:
about 1% of headroom. The "23% gap to the oracle" quoted earlier was an artefact of
comparing against a policy that reads hidden state, and most of that gap was
information no deployable policy could ever have.

Morale changes the character of the problem rather than merely its difficulty. The
greedy oracle - perfect knowledge of the candidate, no planning - now scores *below*
weakest-first, because chasing maximum immediate learning walks the candidate straight
into a run of failures. A planner with the same information scores ~7% above it. That
gap is created by sequencing, not by information, which is what a learned policy is
for. See `ml/baselines.py:GreedyOraclePolicy` for the finding stated in full.

**Known simplifications**, stated because they bound what the results mean:

* Topics are independent. Improving system-design does not help technical-depth.
  A real skill graph has strong correlations; modelling them needs data we do not
  have.
* No forgetting between questions. Episodes are one interview, so decay over weeks
  never arises inside an episode.
* Item difficulty is one of three fixed levels, not a fitted per-question parameter.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from bkt import (
    SOFTNESS,
    BKTParams,
    KnowledgeState,
    observation_confidence,
    update_soft,
)
from bkt import DEFAULT_TOPICS

# Easy / medium / hard. Three levels rather than a continuous difficulty because the
# question generator (Model 3) is prompted at three levels, so a finer action space
# would be one the product cannot actually execute.
DIFFICULTIES: tuple[str, ...] = ("easy", "medium", "hard")

# Difficulty expressed on the same latent scale as mastery, so the two can be
# compared directly. A "hard" question suits a candidate around 0.8 mastery.
DIFFICULTY_LEVEL: dict[str, float] = {"easy": 0.25, "medium": 0.55, "hard": 0.80}

# Attempts are shown to the policy as `min(1, attempts / ATTEMPT_SCALE)`. See the
# note in `_observation`: this is the "have I already asked this?" signal, and how it
# is scaled decides whether the policy can act on it at all.
ATTEMPT_SCALE: float = 3.0

# Morale bounds. The floor is well above zero: a discouraged candidate underperforms,
# but does not stop being able to answer, and a floor of 0 would let one bad run end
# the interview's usefulness entirely.
# Beyond four consecutive failures morale is already near its floor, so further
# counting adds no signal and would only compress the range where it matters.
CONSECUTIVE_FAILURE_CAP: float = 4.0

MORALE_START: float = 0.75
MORALE_FLOOR: float = 0.25


@dataclass
class StudentParams:
    """Traits of one simulated candidate.

    Sampled per episode so the policy meets a population rather than memorising one
    learner - the single most likely way to get a policy that evaluates well and
    generalises not at all.
    """

    # How much a well-matched question moves true mastery. The population spread
    # matters more than the value: a policy tuned to one learning rate is brittle.
    learning_rate: float = 0.18
    # Width of the zone of proximal development. Small values make difficulty
    # matching critical; large values make it nearly irrelevant.
    zpd_width: float = 0.28
    # Spread of the score a candidate produces at a given ability, i.e. how noisy
    # Model 3's rubric is. Without this, scores are a deterministic function of
    # mastery and the policy can invert them to recover the hidden state.
    score_noise: float = 9.0
    # Discrimination: how sharply P(good answer) rises with ability. From item
    # response theory, where this is the `a` parameter.
    discrimination: float = 6.0
    # How fast morale recovers after a good answer and drops after a bad one.
    # Drop exceeds recovery: confidence is easier to lose than to rebuild, which is
    # both the documented asymmetry and what stops the policy from treating morale
    # as free to spend.
    morale_recovery: float = 0.30
    morale_drop: float = 0.40


@dataclass
class SimulatedStudent:
    """One candidate: hidden true mastery, morale, and the traits governing learning."""

    topics: tuple[str, ...] = DEFAULT_TOPICS
    params: StudentParams = field(default_factory=StudentParams)
    true_mastery: dict[str, float] = field(default_factory=dict)
    # Confidence during the interview. Falls after poor answers and recovers after
    # good ones. See `update_morale` for why this exists.
    morale: float = MORALE_START

    def effective_ability(self, topic: str) -> float:
        """Ability as it presents *right now*, after morale.

        A rattled candidate underperforms what they know. The multiplier is bounded
        so morale modulates performance rather than replacing it - at the floor a
        candidate still answers at ~78% of their true level, not at zero.
        """
        return self.true_mastery[topic] * (0.7 + 0.3 * self.morale)

    def probability_of_good_answer(self, topic: str, difficulty: str) -> float:
        """Two-parameter IRT: ability versus item difficulty."""
        ability = self.effective_ability(topic)
        level = DIFFICULTY_LEVEL[difficulty]
        return 1.0 / (1.0 + np.exp(-self.params.discrimination * (ability - level)))

    def update_morale(self, score: float) -> None:
        """Move morale toward the ceiling on a good answer, the floor on a bad one.

        **This is what makes the task require sequencing rather than sorting.**

        Without it, the best strategy is a greedy sort: always ask whichever topic
        currently offers the most expected learning. Measured, that heuristic came
        within 1% of the best achievable observation-limited policy, leaving nothing
        for a learned policy to contribute.

        With morale, a policy that always chases maximum immediate gain drives the
        candidate into a run of failures - weak topics are exactly the ones they
        answer badly - and their morale, and therefore their learning rate, collapses.
        Recovering it costs a question spent somewhere the candidate is strong, which
        yields little learning *now* and pays off later. That trade-off cannot be made
        greedily, which is precisely the case for a learned policy.

        Grounded in self-efficacy and affect research in education rather than
        invented to favour RL, and the same reason human interviewers open with a
        warm-up question. The Phase 3 write-up states it as an assumption, because
        the parameters are hand-set like BKT's.
        """
        if score >= 60.0:
            self.morale += self.params.morale_recovery * (1.0 - self.morale)
        else:
            self.morale -= self.params.morale_drop * (self.morale - MORALE_FLOOR)
        self.morale = float(np.clip(self.morale, MORALE_FLOOR, 1.0))

    def answer(self, topic: str, difficulty: str, rng: np.random.Generator) -> float:
        """Produce a 0-100 rubric score, as Model 3 would for a real answer.

        A *score*, not a boolean, because production now feeds graded evidence into
        BKT. Simulating only pass/fail would train the policy against a coarser
        signal than the one it will actually receive.
        """
        p = self.probability_of_good_answer(topic, difficulty)
        # Centre the score on the success probability, so a candidate who is
        # borderline produces borderline scores rather than a coin flip between
        # excellent and terrible.
        centre = 25.0 + 60.0 * p
        return float(np.clip(rng.normal(centre, self.params.score_noise), 0.0, 100.0))

    def learn(self, topic: str, difficulty: str) -> float:
        """Advance true mastery and return the gain - the reward signal.

        Gain peaks when difficulty matches current ability (the zone of proximal
        development) and is scaled by headroom, so the same question is worth less
        to a candidate who has nearly mastered the topic. Both effects are what stop
        a trivial "always ask the weakest topic at one fixed difficulty" policy from
        being optimal.
        """
        ability = self.true_mastery[topic]
        level = DIFFICULTY_LEVEL[difficulty]
        fit = float(np.exp(-((level - ability) ** 2) / (2.0 * self.params.zpd_width**2)))
        headroom = 1.0 - ability
        # Morale scales how much of the available learning actually lands. A
        # demoralised candidate is present but not absorbing.
        gain = self.params.learning_rate * fit * headroom * self.morale
        self.true_mastery[topic] = min(1.0, ability + gain)
        return self.true_mastery[topic] - ability

    def mean_mastery(self) -> float:
        return float(np.mean([self.true_mastery[t] for t in self.topics]))


def sample_student(
    rng: np.random.Generator, topics: tuple[str, ...] = DEFAULT_TOPICS
) -> SimulatedStudent:
    """Draw a candidate: a few strong topics, a few weak, most in between.

    Beta(2, 3) is skewed toward the lower half, which matches who uses interview
    practice tools - people preparing because they have gaps. A uniform draw would
    make the average candidate stronger than the real population and flatter the
    policy.
    """
    params = StudentParams(
        learning_rate=float(rng.uniform(0.10, 0.26)),
        zpd_width=float(rng.uniform(0.20, 0.36)),
        score_noise=float(rng.uniform(6.0, 12.0)),
        discrimination=float(rng.uniform(4.5, 7.5)),
        morale_recovery=float(rng.uniform(0.20, 0.40)),
        morale_drop=float(rng.uniform(0.30, 0.50)),
    )
    return SimulatedStudent(
        topics=topics,
        params=params,
        true_mastery={t: float(rng.beta(2.0, 3.0)) for t in topics},
    )


class InterviewEnv(gym.Env):
    """Gymnasium environment: choose (topic, difficulty) for each question.

    Observation (32 floats):
        0-14   BKT mastery estimate per topic - what production can see
        15-29  attempts per topic, normalised by episode length
        30     mean of the last 3 answer scores, 0-1
        31     progress through the episode, 0-1
        32     consecutive answers below the pass mark, capped at 4
        33     mean of the last 5 answer scores, 0-1
        34     mean of every answer so far, 0-1

    Indices 30 and 32-34 are the policy's only window onto morale, which is hidden -
    as in production, where scores are recorded but confidence is not. All four are
    computable from the score history the app already stores, so none of them is
    information the deployed system would lack.

    Action: ``topic_index * len(DIFFICULTIES) + difficulty_index``, 45 discrete.

    Reward: true mastery gained on the asked topic, scaled, minus a small constant
    per-question cost.
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        questions_per_episode: int = 20,
        bkt_params: BKTParams | None = None,
        reward_scale: float = 10.0,
        time_cost: float = 0.02,
        repetition_penalty: float = 0.0,
        softness: float = SOFTNESS,
        seed: int | None = None,
    ) -> None:
        super().__init__()
        self.topics = DEFAULT_TOPICS
        self.questions_per_episode = questions_per_episode
        self.bkt_params = bkt_params or BKTParams()
        self.reward_scale = reward_scale
        self.time_cost = time_cost
        # Defaults to zero. The phase plan called for an explicit penalty on
        # re-asking mastered topics, but the gain term already decays to nothing as
        # mastery rises, so an extra penalty double-counts and creates an easy way to
        # score well by simply avoiding questions. Kept as a knob for the ablation
        # rather than switched on by default.
        self.repetition_penalty = repetition_penalty
        self.softness = softness

        self.action_space = spaces.Discrete(len(self.topics) * len(DIFFICULTIES))
        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(2 * len(self.topics) + 5,), dtype=np.float32
        )

        self._rng = np.random.default_rng(seed)
        self.student: SimulatedStudent | None = None
        self.knowledge: KnowledgeState | None = None

    # --- gym API ---------------------------------------------------------

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self._rng = np.random.default_rng(seed)

        self.student = sample_student(self._rng, self.topics)
        # The system starts from its priors, knowing nothing about this candidate -
        # exactly the position a real first session is in.
        self.knowledge = KnowledgeState(topics=self.topics, params=self.bkt_params)
        self.step_count = 0
        self.recent_scores: list[float] = []
        self.attempts = {t: 0 for t in self.topics}
        self.initial_true_mastery = self.student.mean_mastery()
        self.student.morale = MORALE_START
        return self._observation(), self._info()

    def step(self, action: int):
        if self.student is None or self.knowledge is None:
            raise RuntimeError("reset() must be called before step()")
        topic, difficulty = self.decode_action(int(action))

        score = self.student.answer(topic, difficulty, self._rng)
        # Order matters: the answer is produced at the morale the candidate walked in
        # with, then learning is scaled by it, and only then does this answer's
        # outcome move morale for the next question.
        gain = self.student.learn(topic, difficulty)
        self.student.update_morale(score)

        # The system updates its belief from the observed score alone, through the
        # identical code path production uses.
        confidence = observation_confidence(score, softness=self.softness)
        self.knowledge.mastery[topic] = update_soft(
            self.knowledge.mastery[topic], confidence, self.bkt_params
        )
        self.knowledge.attempts[topic] += 1
        self.attempts[topic] += 1

        self.recent_scores.append(score)
        self.step_count += 1

        reward = gain * self.reward_scale - self.time_cost
        if self.repetition_penalty and self.student.true_mastery[topic] > 0.85:
            reward -= self.repetition_penalty

        terminated = False
        truncated = self.step_count >= self.questions_per_episode
        return self._observation(), float(reward), terminated, truncated, self._info(score)

    # --- helpers ---------------------------------------------------------

    def decode_action(self, action: int) -> tuple[str, str]:
        topic_index, difficulty_index = divmod(action, len(DIFFICULTIES))
        return self.topics[topic_index], DIFFICULTIES[difficulty_index]

    def encode_action(self, topic: str, difficulty: str) -> int:
        return self.topics.index(topic) * len(DIFFICULTIES) + DIFFICULTIES.index(difficulty)

    def _observation(self) -> np.ndarray:
        assert self.knowledge is not None
        estimated = [self.knowledge.mastery[t] for t in self.topics]
        # Scaled so that "asked once" is clearly visible, not by episode length.
        #
        # Dividing by questions_per_episode (20) was a real mistake: one attempt
        # registered as 0.05, a 5% blip in a feature sitting beside mastery values
        # that swing by 0.5. Repeating a topic is the single most costly thing a
        # policy can do here - gain is proportional to headroom, so the second ask is
        # worth far less than the first - and the trained policy could not see it.
        # It covered 10 of 15 topics and lost to round-robin, which has no
        # intelligence at all but never repeats.
        #
        # ATTEMPT_SCALE = 3 puts one attempt at 0.33 and saturates at three, which is
        # where the marginal value of another ask has essentially gone.
        attempts = [
            min(1.0, self.attempts[t] / ATTEMPT_SCALE) for t in self.topics
        ]
        window = self.recent_scores[-3:]
        recent = float(np.mean(window) / 100.0) if window else 0.5
        progress = self.step_count / self.questions_per_episode

        # Morale-tracking features. A single 3-answer mean explained only 59% of the
        # variance in hidden morale; adding the consecutive-failure count raises that
        # to 75%, because morale decays per *consecutive* failure and a mean cannot
        # distinguish "two bad then one good" from "one good then two bad" - which
        # leave very different morale.
        #
        # Every one of these is derivable from the score history the production app
        # already stores, so this is a representation fix rather than extra
        # information the deployed system would not have.
        consecutive = 0
        for score in reversed(self.recent_scores):
            if score < 60.0:
                consecutive += 1
            else:
                break
        streak = min(1.0, consecutive / CONSECUTIVE_FAILURE_CAP)
        last_five = (
            float(np.mean(self.recent_scores[-5:]) / 100.0) if self.recent_scores else 0.5
        )
        session = (
            float(np.mean(self.recent_scores) / 100.0) if self.recent_scores else 0.5
        )

        return np.array(
            estimated + attempts + [recent, progress, streak, last_five, session],
            dtype=np.float32,
        )

    def _info(self, score: float | None = None) -> dict:
        assert self.student is not None
        info = {
            "true_mean_mastery": self.student.mean_mastery(),
            "true_mastery_gain": self.student.mean_mastery() - self.initial_true_mastery,
            "step": self.step_count,
            # Hidden from the policy, exposed for diagnostics and plots.
            "morale": self.student.morale,
        }
        if score is not None:
            info["score"] = score
        return info
