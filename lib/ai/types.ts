import type {
  InterviewContext,
  Question,
  AnswerEvaluation,
  SessionReport,
  ParsedResume,
  GapMatrix,
} from '@/types'

export interface AIProvider {
  generateQuestion(context: InterviewContext): Promise<Question>
  evaluateAnswer(
    question: string,
    answer: string,
    context: InterviewContext
  ): Promise<AnswerEvaluation>
  generateFollowUp(
    answer: string,
    claim: string,
    context: InterviewContext
  ): Promise<Question>
  generateSessionReport(
    session: SessionData
  ): Promise<SessionReport>
  parseResume(resumeText: string): Promise<ParsedResume>
  buildGapMatrix(resumeSkills: string[], jdText: string): Promise<GapMatrix>
  extractJDFields(jdText: string): Promise<RawJDFields>
  generateQuestionPlan(context: Omit<InterviewContext, 'question_plan' | 'current_question_index'>): Promise<import('@/types').QuestionPlan>
}

/**
 * What the model returns for a pasted JD, before validation.
 *
 * Deliberately all-optional and loosely typed: this is the *unvalidated* shape. The
 * caller (`lib/jd/fields.ts`) coerces it onto the real `JobDescription` columns, because
 * `role_type` and `company_tier` are Postgres enums and a hallucinated value would be
 * rejected by the database at insert time rather than caught here.
 */
export interface RawJDFields {
  company_name?: string
  role_subtype?: string
  role_type?: string
  company_tier?: string
  industry?: string
  seniority?: string
  required_skills?: string[]
  nice_to_have_skills?: string[]
  culture_tags?: string[]
}

export interface SessionData {
  session_id: string
  round_type: import('@/types').RoundType
  company_name: string
  role_name: string
  transcript: Array<{
    question: string
    question_type: string
    answer: string
    evaluation: AnswerEvaluation | null
  }>
  scores: Partial<import('@/types').SessionScores>
  gap_matrix: GapMatrix
}
