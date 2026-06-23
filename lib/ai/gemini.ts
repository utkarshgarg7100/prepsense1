import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, SessionData } from './types'
import type {
  InterviewContext,
  Question,
  AnswerEvaluation,
  SessionReport,
  ParsedResume,
  GapMatrix,
  QuestionPlan,
} from '@/types'
import {
  RESUME_PARSER_PROMPT,
  JD_PARSER_PROMPT,
  GAP_MATRIX_PROMPT,
  getInterviewerSystemPrompt,
  ANSWER_EVALUATION_PROMPT,
  SESSION_REPORT_PROMPT,
  QUESTION_PLAN_PROMPT,
  RESUME_MARKER_PROMPT,
} from '@/lib/prompts'

function parseJSON<T>(text: string): T {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(cleaned)
}

function interpolate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), value),
    template
  )
}

export class GeminiProvider implements AIProvider {
  private genAI: GoogleGenerativeAI
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!)
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-pro' })
  }

  private async generate(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt)
    return result.response.text()
  }

  async generateQuestion(context: InterviewContext): Promise<Question> {
    const systemPrompt = getInterviewerSystemPrompt(
      context.round_type,
      context.company_name,
      context.role_name,
      context.resume_text.substring(0, 1000),
      context.jd_text.substring(0, 800),
      context.gap_matrix.recommended_focus_areas
    )

    const currentPlan = context.question_plan.planned_questions[context.current_question_index]
    const historyText = context.conversation_history
      .slice(-3)
      .map(t => `Q: ${t.question}\nA: ${t.answer}`)
      .join('\n\n')

    const prompt = `${systemPrompt}

Current conversation history (last 3 exchanges):
${historyText || 'This is the first question.'}

Claims candidate has made so far: ${context.claims_history.join(', ') || 'none yet'}

Next question should be of type: ${currentPlan?.question_type || 'base_role'}
Category: ${currentPlan?.category || 'base_role'}
Tags to cover: ${currentPlan?.question_tags.join(', ') || 'general'}
Hint: ${currentPlan?.source_hint || 'Start with a strong opener'}

Generate the next interview question. Return JSON only.`

    const text = await this.generate(prompt)
    const parsed = parseJSON<{
      message: string
      next_question: string
      question_type: string
      question_tags: string[]
      follow_up_trigger: boolean
      reasoning: string
    }>(text)

    return {
      content: parsed.message,
      question_type: parsed.question_type,
      question_tags: parsed.question_tags,
      follow_up_trigger: parsed.follow_up_trigger,
      reasoning: parsed.reasoning,
    }
  }

  async evaluateAnswer(
    question: string,
    answer: string,
    context: InterviewContext
  ): Promise<AnswerEvaluation> {
    const currentPlan = context.question_plan.planned_questions[context.current_question_index]
    const historyText = context.conversation_history
      .slice(-3)
      .map(t => `Q: ${t.question}\nA: ${t.answer}`)
      .join('\n\n')

    const prompt = interpolate(ANSWER_EVALUATION_PROMPT, {
      question,
      question_type: currentPlan?.question_type || 'general',
      question_tags: currentPlan?.question_tags.join(', ') || 'general',
      answer,
      conversation_history: historyText || 'No prior context',
      claims_history: context.claims_history.join(', ') || 'none',
    })

    const text = await this.generate(prompt)
    return parseJSON<AnswerEvaluation>(text)
  }

  async generateFollowUp(
    answer: string,
    claim: string,
    context: InterviewContext
  ): Promise<Question> {
    const systemPrompt = getInterviewerSystemPrompt(
      context.round_type,
      context.company_name,
      context.role_name,
      context.resume_text.substring(0, 500),
      context.jd_text.substring(0, 400),
      context.gap_matrix.recommended_focus_areas
    )

    const prompt = `${systemPrompt}

The candidate just said: "${answer}"
They made this specific claim: "${claim}"

Generate a probing follow-up question to dig deeper into this claim. Make it specific and challenging.
Return JSON only.`

    const text = await this.generate(prompt)
    const parsed = parseJSON<{
      message: string
      question_type: string
      question_tags: string[]
      follow_up_trigger: boolean
      reasoning: string
    }>(text)

    return {
      content: parsed.message,
      question_type: 'follow_up',
      question_tags: parsed.question_tags,
      follow_up_trigger: false,
      reasoning: parsed.reasoning,
    }
  }

  async generateSessionReport(session: SessionData): Promise<SessionReport> {
    const transcriptText = session.transcript
      .map((t, i) => `Q${i + 1} [${t.question_type}]: ${t.question}\nAnswer: ${t.answer}\nScore: ${t.evaluation?.depth_score ?? 'N/A'}/100`)
      .join('\n\n')

    const scoresText = JSON.stringify(session.scores, null, 2)

    const prompt = interpolate(SESSION_REPORT_PROMPT, {
      company_name: session.company_name,
      role_name: session.role_name,
      round_type: session.round_type,
      overall_score: String(session.scores.overall_score ?? 0),
      transcript: transcriptText,
      scores: scoresText,
    })

    const text = await this.generate(prompt)
    return parseJSON<SessionReport>(text)
  }

  async parseResume(resumeText: string): Promise<ParsedResume> {
    const prompt = `${RESUME_PARSER_PROMPT}\n\nResume text:\n${resumeText}`
    const text = await this.generate(prompt)
    return parseJSON<ParsedResume>(text)
  }

  async buildGapMatrix(resumeSkills: string[], jdText: string): Promise<GapMatrix> {
    const jdParsePrompt = `${JD_PARSER_PROMPT}\n\nJob Description:\n${jdText}`
    const jdText2 = await this.generate(jdParsePrompt)
    const jdParsed = parseJSON<{ required_skills: string[]; nice_to_have_skills: string[] }>(jdText2)

    const prompt = interpolate(GAP_MATRIX_PROMPT, {
      resume_skills: resumeSkills.join(', '),
      jd_required_skills: jdParsed.required_skills.join(', '),
      jd_nice_to_have_skills: jdParsed.nice_to_have_skills.join(', '),
    })

    const text = await this.generate(prompt)
    return parseJSON<GapMatrix>(text)
  }

  async generateQuestionPlan(
    context: Omit<InterviewContext, 'question_plan' | 'current_question_index'>
  ): Promise<QuestionPlan> {
    const prompt = interpolate(QUESTION_PLAN_PROMPT, {
      role_name: context.role_name,
      company_name: context.company_name,
      round_type: context.round_type,
      resume_skills: context.gap_matrix.matched_skills.join(', '),
      jd_required_skills: context.gap_matrix.missing_skills.join(', '),
      gap_areas: context.gap_matrix.recommended_focus_areas.join(', '),
      experience_level: 'mid-level',
    })

    const text = await this.generate(prompt)
    return parseJSON<QuestionPlan>(text)
  }

  async generateResumeMarkers(
    resumeText: string,
    transcript: SessionData['transcript'],
    jdRequiredSkills: string[]
  ): Promise<Array<{ resume_line_text: string; marker_type: string; suggestion: string }>> {
    const transcriptText = transcript
      .map(t => `Q: ${t.question}\nA: ${t.answer}\nScore: ${t.evaluation?.depth_score ?? 50}`)
      .join('\n\n')

    const prompt = interpolate(RESUME_MARKER_PROMPT, {
      resume_text: resumeText,
      transcript: transcriptText,
      jd_required_skills: jdRequiredSkills.join(', '),
    })

    const text = await this.generate(prompt)
    return parseJSON(text)
  }
}
