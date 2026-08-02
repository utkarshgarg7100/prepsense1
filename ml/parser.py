"""Resume / job-description parser (Model 5).

Reads a CV and a job description and produces a **per-topic gap vector**: for each
of the 15 topics in ``bkt.DEFAULT_TOPICS``, how much the job asks for it versus how
much evidence the candidate's resume shows. That vector seeds the starting mastery
priors for Bayesian Knowledge Tracing (Model 2), so a new user's first interview
already targets their likely weak spots instead of starting from a flat prior.

Method, in order:

1. **Lemmatise** both documents with spaCy, dropping stop words and punctuation.
   Lemmatisation matters more than usual here because resumes and JDs describe the
   same skill in different inflections - "led a team", "leading teams", "leadership"
   must all reach the ``leadership`` topic.
2. **TF-IDF** over a corpus of the two real documents plus one pseudo-document per
   topic (its keyword lexicon). Fitting on 17 documents rather than 2 gives IDF
   something to actually discriminate on: a term appearing in every topic lexicon
   is down-weighted automatically, so we don't have to hand-tune stop lists.
3. **Cosine similarity** between each document and each topic pseudo-document. This
   is textbook vector-space retrieval, and because TF-IDF vectors are non-negative
   the similarity is already bounded in [0, 1].
4. **Gap** = what the JD demands minus what the resume evidences, floored at zero.

Why classical NLP and not an LLM: this runs offline with no API key, costs nothing
per call, is deterministic (the same CV always yields the same vector, which the
BKT parity tests depend on), and every score can be traced back to the specific
words that produced it - see ``explain()``. The LLM parser in
``app/api/resume/parse/route.ts`` is kept as a comparison baseline.
"""

from __future__ import annotations

import functools
import math
import re
from dataclasses import dataclass, field

from sklearn.feature_extraction.text import TfidfVectorizer

from bkt import DEFAULT_TOPICS, BKTParams

# Keyword lexicons, one per topic. These are the model: they are hand-built and
# deliberately visible rather than learned, because there is no labelled corpus of
# (resume, JD, true skill gap) triples to learn from, and a hand-built lexicon can
# be inspected and corrected by a human reading the report.
#
# Entries are matched after lemmatisation, so write the lemma form ("lead", not
# "led"/"leading"). Multi-word entries are matched as phrases before tokenisation.
TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "system-design": (
        "system design", "architecture", "scalability", "scalable", "distributed",
        "microservice", "load balancing", "caching", "throughput", "latency",
        "high availability", "sharding", "queue", "infrastructure", "design system",
    ),
    "leadership": (
        "lead", "leadership", "mentor", "manage", "management", "team lead",
        "supervise", "coach", "delegate", "direct report", "hire", "onboard",
        "stakeholder", "cross functional", "influence",
    ),
    "conflict": (
        "conflict", "disagree", "disagreement", "negotiate", "negotiation",
        "resolve", "resolution", "mediate", "escalate", "pushback", "tension",
        "difficult conversation", "align", "consensus",
    ),
    "technical-depth": (
        "algorithm", "data structure", "optimize", "optimization", "performance",
        "debug", "profiling", "concurrency", "memory", "complexity", "implement",
        "engineering", "codebase", "refactor", "testing",
    ),
    "behavioral": (
        "collaborate", "collaboration", "teamwork", "communicate", "adapt",
        "initiative", "responsibility", "feedback", "culture", "interpersonal",
        "motivate", "empathy", "star",
    ),
    "product-sense": (
        "product", "user", "customer", "roadmap", "requirement", "feature",
        "prioritize", "prioritization", "market", "user research", "usability",
        "product management", "discovery", "persona",
    ),
    "metrics": (
        "metric", "kpi", "measure", "analytics", "data driven", "experiment",
        "a/b test", "conversion", "retention", "dashboard", "instrumentation",
        "benchmark", "roi", "quantify", "impact",
    ),
    "communication": (
        "communication", "present", "presentation", "document", "documentation",
        "write", "writing", "explain", "articulate", "report", "audience",
        "stakeholder communication", "clarity", "storytelling",
    ),
    "ownership": (
        "own", "ownership", "accountable", "accountability", "drive", "deliver",
        "end to end", "autonomy", "independently", "initiative", "responsible",
        "ship", "follow through",
    ),
    "problem-solving": (
        "problem solving", "troubleshoot", "diagnose", "root cause", "analyse",
        "analyze", "analytical", "solution", "resolve issue", "investigate",
        "critical thinking", "hypothesis", "incident",
    ),
    "cultural-fit": (
        "value", "mission", "culture", "collaborative", "inclusive", "diversity",
        "growth mindset", "learn", "curiosity", "integrity", "transparency",
        "team culture", "belonging",
    ),
    "resume-probe": (
        "experience", "background", "role", "responsibility", "achievement",
        "accomplishment", "project", "tenure", "history", "previous", "career",
    ),
    "gap-probe": (
        "requirement", "qualification", "preferred", "must have", "nice to have",
        "proficiency", "expertise", "familiarity", "exposure", "certification",
        "degree", "year of experience",
    ),
    "ambiguity": (
        "ambiguity", "ambiguous", "uncertain", "uncertainty", "undefined",
        "vague", "evolving", "changing priority", "fast paced", "startup",
        "scrappy", "unstructured", "pivot", "adapt",
    ),
    "first-principles": (
        "first principle", "fundamental", "reasoning", "from scratch", "trade off",
        "tradeoff", "assumption", "why", "derive", "rationale", "justify",
        "decision making", "framework",
    ),
}

# A gap of 0 leaves the default prior untouched; a gap of 1 pushes the prior to the
# floor. The band is deliberately narrow and never reaches 0 or 1: the parser is
# keyword matching on two short documents, and it should nudge where the interview
# starts, not assert that the candidate definitely cannot do something. BKT's own
# evidence updates are what should move mastery decisively.
PRIOR_FLOOR = 0.08
PRIOR_CEILING = 0.45


@functools.lru_cache(maxsize=1)
def _load_nlp():
    """Load spaCy lazily and once.

    Loading costs ~0.5s, which is fine per process but not per call. The parser
    only needs the tagger and lemmatiser, so the NER and parser components are
    disabled - roughly a 3x speedup on long documents.
    """
    import spacy

    try:
        return spacy.load("en_core_web_sm", disable=["ner", "parser"])
    except OSError as exc:  # pragma: no cover - environment problem, not logic
        raise RuntimeError(
            "spaCy model 'en_core_web_sm' is not installed. Run:\n"
            "  ml/.venv/bin/python -m spacy download en_core_web_sm"
        ) from exc


def _phrase_key(phrase: str) -> str:
    """Collapse a multi-word keyword into a single token.

    "system design" becomes "system_design" so TF-IDF treats it as one term. Done
    on both the lexicon and the document, otherwise a phrase keyword could never
    match anything.
    """
    return re.sub(r"\s+", "_", phrase.strip().lower())


# Phrases must be substituted longest-first, so that "user research" is consumed
# before the bare "user" inside it can be.
_ALL_PHRASES: tuple[str, ...] = tuple(
    sorted(
        {kw for kws in TOPIC_KEYWORDS.values() for kw in kws if " " in kw},
        key=len,
        reverse=True,
    )
)


def normalise(text: str) -> str:
    """Lemmatise and clean one document, collapsing known multi-word phrases.

    Returns a space-joined string of lemmas, which is what TfidfVectorizer wants.
    """
    if not text or not text.strip():
        return ""

    lowered = text.lower()
    # Substitute phrases before tokenisation, since lemmatisation would otherwise
    # split them apart and lose the phrase-level meaning.
    for phrase in _ALL_PHRASES:
        if phrase in lowered:
            lowered = lowered.replace(phrase, _phrase_key(phrase))

    doc = _load_nlp()(lowered)
    return " ".join(
        token.lemma_
        for token in doc
        if not token.is_stop and not token.is_punct and not token.is_space
    )


def _lexicon_document(topic: str) -> str:
    """The pseudo-document representing a topic, in the same normalised space."""
    return " ".join(_phrase_key(kw) if " " in kw else kw for kw in TOPIC_KEYWORDS[topic])


@dataclass(frozen=True)
class ParseResult:
    """Per-topic demand, evidence, and the gap between them.

    All three dicts are keyed by every topic in ``topics``, always - a caller can
    index any topic without a membership check.
    """

    topics: tuple[str, ...]
    demand: dict[str, float]    # how strongly the JD asks for the topic
    evidence: dict[str, float]  # how strongly the resume evidences it
    gaps: dict[str, float]      # max(0, demand - evidence), rescaled to [0, 1]
    matched_terms: dict[str, tuple[str, ...]] = field(default_factory=dict)

    def vector(self) -> list[float]:
        """Gaps in the fixed topic order - the shape downstream code consumes."""
        return [self.gaps[t] for t in self.topics]

    def priors(self, params: BKTParams | None = None) -> dict[str, float]:
        """Convert gaps into BKT starting mastery priors.

        A large gap means the JD wants something the resume does not evidence, so
        the candidate is *less* likely to already have it - priors move down as
        gaps go up, interpolating between the default prior and ``PRIOR_FLOOR``.
        Topics with no gap sit slightly above the default, capped at
        ``PRIOR_CEILING``: evidence on a resume is weak proof of interview
        performance, which is the whole reason the interview exists.
        """
        params = params or BKTParams()
        default = params.p_init
        out: dict[str, float] = {}
        for topic in self.topics:
            gap = self.gaps[topic]
            if gap > 0.0:
                out[topic] = default - (default - PRIOR_FLOOR) * gap
            else:
                # No gap: nudge up by how much evidence there is, not to the ceiling.
                out[topic] = default + (PRIOR_CEILING - default) * self.evidence[topic]
        return out

    def weakest(self, n: int = 5) -> list[str]:
        """The n topics with the largest gaps - the interview's opening focus."""
        return sorted(self.topics, key=lambda t: -self.gaps[t])[:n]

    def explain(self, topic: str) -> str:
        """Human-readable account of why a topic scored as it did."""
        terms = self.matched_terms.get(topic, ())
        matched = ", ".join(terms) if terms else "no keywords matched"
        return (
            f"{topic}: demand={self.demand[topic]:.2f} "
            f"evidence={self.evidence[topic]:.2f} gap={self.gaps[topic]:.2f} "
            f"({matched})"
        )


def _cosine_profile(doc_vec, topic_vecs) -> list[float]:
    """Cosine similarity of one document against every topic pseudo-document.

    TF-IDF rows from scikit-learn are already L2-normalised, so the dot product is
    the cosine directly.
    """
    return [float(doc_vec.multiply(tv).sum()) for tv in topic_vecs]


def _rescale(values: list[float], peak: float) -> list[float]:
    """Scale a profile into [0, 1] against its own peak topic.

    Each document is normalised separately, which makes demand and evidence
    *relative profiles*: "of what this JD asks for, how much is system design" and
    "of what this CV evidences, how much is system design". They are not absolute
    competence measures, and the gap is therefore a difference of emphasis.

    A shared scale factor was tried first and is worse. Cosine similarity is
    invariant to document length but not to topical *breadth*: a short JD spends
    all its words on two or three topics and scores high against them, while a long
    CV covering ten topics is diluted against every lexicon. On a shared scale the
    JD wins nearly every topic, so even a well-matched candidate shows large gaps
    everywhere.

    The cost of self-normalising is that exactly one topic per document scores 1.0,
    so the JD's top topic shows some gap unless it is also the CV's top topic. That
    is a real limitation of the method rather than a bug, and it is the reason gaps
    are only used to *nudge* BKT priors within a narrow band. An all-zero profile
    stays zero rather than dividing by 0.
    """
    if peak <= 0.0:
        return [0.0] * len(values)
    return [min(1.0, v / peak) for v in values]


def parse(
    resume_text: str,
    jd_text: str,
    topics: tuple[str, ...] = DEFAULT_TOPICS,
) -> ParseResult:
    """Produce the per-topic gap vector for one (resume, JD) pair.

    Either document may be empty or unparseable; the result is still a full,
    valid vector. That guarantee matters because every downstream phase indexes
    this vector positionally, so a short or malformed vector would corrupt the
    knowledge state silently rather than raising.
    """
    unknown = set(topics) - set(TOPIC_KEYWORDS)
    if unknown:
        raise KeyError(f"no keyword lexicon for topic(s): {sorted(unknown)}")

    resume_norm = normalise(resume_text)
    jd_norm = normalise(jd_text)
    lexicons = [_lexicon_document(t) for t in topics]

    # If neither document survived normalisation there is nothing to measure. Return
    # a zero vector: no demand, no evidence, no gap. Callers get default priors,
    # which is the correct behaviour for "we know nothing about this candidate".
    if not resume_norm and not jd_norm:
        zeros = {t: 0.0 for t in topics}
        return ParseResult(
            topics=topics, demand=dict(zeros), evidence=dict(zeros), gaps=dict(zeros)
        )

    corpus = [resume_norm, jd_norm, *lexicons]
    # token_pattern keeps our underscore phrase keys intact and drops pure numbers,
    # which are noise here (dates, bullet counts) and would otherwise inflate IDF.
    vectorizer = TfidfVectorizer(
        token_pattern=r"(?u)\b[a-z][a-z_]+\b",
        sublinear_tf=True,  # damps a term repeated 20x in a long CV
        min_df=1,
    )
    matrix = vectorizer.fit_transform(corpus)

    resume_vec, jd_vec = matrix[0], matrix[1]
    topic_vecs = [matrix[2 + i] for i in range(len(topics))]

    evidence_raw = _cosine_profile(resume_vec, topic_vecs)
    demand_raw = _cosine_profile(jd_vec, topic_vecs)

    evidence = _rescale(evidence_raw, max(evidence_raw, default=0.0))
    demand = _rescale(demand_raw, max(demand_raw, default=0.0))

    # The gap is what the job wants beyond what the CV shows. Negative values -
    # strengths the job did not ask about - are floored at zero rather than kept as
    # negative gaps, because BKT priors cannot express "better than the ceiling"
    # and a strength in an untested area should not pull the interview toward it.
    gaps = [max(0.0, d - e) for d, e in zip(demand, evidence)]

    # Terms actually present in the *documents*. Deliberately not
    # `vectorizer.vocabulary_`: the topic lexicons are themselves documents in the
    # corpus, so every keyword is always in the fitted vocabulary and explain()
    # would claim a full match for a CV that mentioned none of them.
    document_terms = set(resume_norm.split()) | set(jd_norm.split())
    matched = {
        topic: tuple(
            kw for kw in TOPIC_KEYWORDS[topic]
            if (_phrase_key(kw) if " " in kw else kw) in document_terms
        )
        for topic in topics
    }

    result = ParseResult(
        topics=topics,
        demand=dict(zip(topics, demand)),
        evidence=dict(zip(topics, evidence)),
        gaps=dict(zip(topics, gaps)),
        matched_terms=matched,
    )
    _assert_valid(result)
    return result


def _assert_valid(result: ParseResult) -> None:
    """Invariant check on the way out.

    Phase 1's bug guard. Every downstream consumer - the BKT priors, the RL policy's
    observation vector, the report UI - indexes this positionally, so a vector of
    the wrong length or with an out-of-range value corrupts them all without
    raising anywhere near the cause. Cheap to check, expensive to debug.
    """
    for name, values in (
        ("demand", result.demand),
        ("evidence", result.evidence),
        ("gaps", result.gaps),
    ):
        if len(values) != len(result.topics):
            raise AssertionError(
                f"{name} has {len(values)} entries, expected {len(result.topics)}"
            )
        for topic, value in values.items():
            if math.isnan(value) or not 0.0 <= value <= 1.0:
                raise AssertionError(f"{name}[{topic}] = {value!r} is outside [0, 1]")
