/**
 * Topic keyword lexicons for the resume/JD parser (Model 5).
 *
 * GENERATED from `ml/parser.py:TOPIC_KEYWORDS` — do not edit by hand. The Python
 * version is the source of truth; `ml/test_parity.py` fails if the two drift, which
 * matters because both sides feed the same knowledge-state vector and a mismatch
 * would show up as a silently wrong interview focus rather than an error.
 *
 * To regenerate, see the "Model 5 integration" note in PROGRESS.md.
 */

import { DEFAULT_TAGS } from '@/lib/rl/bandit'

/**
 * The topic taxonomy, in the fixed order everything downstream indexes by.
 * Mirrors `ml/bkt.py:DEFAULT_TOPICS`.
 */
export const TOPICS = DEFAULT_TAGS as readonly string[]

export const TOPIC_KEYWORDS: Record<string, readonly string[]> = {
  'system-design': [
    'system design', 'architecture', 'scalability', 'scalable', 'distributed',
    'microservice', 'load balancing', 'caching', 'throughput', 'latency',
    'high availability', 'sharding', 'queue', 'infrastructure', 'design system',
  ],
  'leadership': [
    'lead', 'leadership', 'mentor', 'manage', 'management', 'team lead', 'supervise',
    'coach', 'delegate', 'direct report', 'hire', 'onboard', 'stakeholder',
    'cross functional', 'influence',
  ],
  'conflict': [
    'conflict', 'disagree', 'disagreement', 'negotiate', 'negotiation', 'resolve',
    'resolution', 'mediate', 'escalate', 'pushback', 'tension', 'difficult conversation',
    'align', 'consensus',
  ],
  'technical-depth': [
    'algorithm', 'data structure', 'optimize', 'optimization', 'performance', 'debug',
    'profiling', 'concurrency', 'memory', 'complexity', 'implement', 'engineering',
    'codebase', 'refactor', 'testing',
  ],
  'behavioral': [
    'collaborate', 'collaboration', 'teamwork', 'communicate', 'adapt', 'initiative',
    'responsibility', 'feedback', 'culture', 'interpersonal', 'motivate', 'empathy', 'star',
  ],
  'product-sense': [
    'product', 'user', 'customer', 'roadmap', 'requirement', 'feature', 'prioritize',
    'prioritization', 'market', 'user research', 'usability', 'product management',
    'discovery', 'persona',
  ],
  'metrics': [
    'metric', 'kpi', 'measure', 'analytics', 'data driven', 'experiment', 'a/b test',
    'conversion', 'retention', 'dashboard', 'instrumentation', 'benchmark', 'roi',
    'quantify', 'impact',
  ],
  'communication': [
    'communication', 'present', 'presentation', 'document', 'documentation', 'write',
    'writing', 'explain', 'articulate', 'report', 'audience', 'stakeholder communication',
    'clarity', 'storytelling',
  ],
  'ownership': [
    'own', 'ownership', 'accountable', 'accountability', 'drive', 'deliver', 'end to end',
    'autonomy', 'independently', 'initiative', 'responsible', 'ship', 'follow through',
  ],
  'problem-solving': [
    'problem solving', 'troubleshoot', 'diagnose', 'root cause', 'analyse', 'analyze',
    'analytical', 'solution', 'resolve issue', 'investigate', 'critical thinking',
    'hypothesis', 'incident',
  ],
  'cultural-fit': [
    'value', 'mission', 'culture', 'collaborative', 'inclusive', 'diversity',
    'growth mindset', 'learn', 'curiosity', 'integrity', 'transparency', 'team culture',
    'belonging',
  ],
  'resume-probe': [
    'experience', 'background', 'role', 'responsibility', 'achievement', 'accomplishment',
    'project', 'tenure', 'history', 'previous', 'career',
  ],
  'gap-probe': [
    'requirement', 'qualification', 'preferred', 'must have', 'nice to have', 'proficiency',
    'expertise', 'familiarity', 'exposure', 'certification', 'degree', 'year of experience',
  ],
  'ambiguity': [
    'ambiguity', 'ambiguous', 'uncertain', 'uncertainty', 'undefined', 'vague', 'evolving',
    'changing priority', 'fast paced', 'startup', 'scrappy', 'unstructured', 'pivot',
    'adapt',
  ],
  'first-principles': [
    'first principle', 'fundamental', 'reasoning', 'from scratch', 'trade off', 'tradeoff',
    'assumption', 'why', 'derive', 'rationale', 'justify', 'decision making', 'framework',
  ],
}

/**
 * Priors are confined to this band on purpose. Keyword matching over two short
 * documents should nudge where an interview starts, not assert that a candidate
 * cannot do something — BKT's own evidence updates are what should move mastery
 * decisively. Mirrors PRIOR_FLOOR / PRIOR_CEILING in `ml/parser.py`.
 */
export const PRIOR_FLOOR = 0.08
export const PRIOR_CEILING = 0.45
