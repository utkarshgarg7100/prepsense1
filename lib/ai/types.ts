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
  generateQuestionPlan(context: Omit<InterviewContext, 'question_plan' | 'current_question_index'>): Promise<import('@/types').QuestionPlan>
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
