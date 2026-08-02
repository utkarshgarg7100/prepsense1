import OpenAI from 'openai'
import type { AIProvider, SessionData, RawJDFields } from './types'
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
  JD_FIELDS_PROMPT,
  GAP_MATRIX_PROMPT,
  getInterviewerSystemPrompt,
  ANSWER_EVALUATION_PROMPT,
  SESSION_REPORT_PROMPT,
  QUESTION_PLAN_PROMPT,
  RESUME_MARKER_PROMPT,
} from '@/lib/prompts'
import { reconcileEvaluation } from './reconcile'

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

// How much of the candidate's CV reaches the interviewer.
//
// This was 1000/500, which is roughly the top third of a one-page CV — name,
// contact details, summary line, most recent role. Everything below that was
// invisible, so the interviewer could not ask about a candidate's best project
// and could not validate a claim it had never seen.
//
// 6000 covers a full two-page CV. llama-3.3-70b has a 128k context window, so
// this is not close to any limit; the old value was a guess, not a constraint.
const RESUME_CHARS_QUESTION = 6000
// Follow-ups get less because the answer being probed is what matters there,
// but still enough to cover a full page rather than a header block.
const RESUME_CHARS_FOLLOWUP = 3000

// Anything that produces a *measurement* is sampled greedily.
//
// These calls previously ran at the API default of 1.0, so submitting the same
// answer twice produced two different scores. That noise did not stop at the
// score: BKT consumes it as evidence, so the mastery estimate inherited it, and
// the RL controller then chose topics from a number that moved on its own. An
// evaluator that disagrees with itself is also indefensible in a write-up, and
// it denies anyone building a replacement (Model 3 rework) a stable baseline to
// measure against.
//
// Note the asymmetry with question generation, which is deliberately left at the
// default: writing should vary, measuring should not.
const GRADING_TEMPERATURE = 0

/**
 * The AI provider. Groq is the only one.
 *
 * Groq exposes an OpenAI-compatible chat API, so the official `openai` SDK is
 * used as the transport with the base URL pointed at Groq. `generate` asks for
 * native JSON mode: every method here parses the response as JSON, and having
 * the server guarantee well-formed JSON is far more reliable than stripping
 * markdown fences off a free-form completion.
 *
 * Chosen because the free tier (2,000 requests/day) comfortably covers
 * development and demo use, and the same key also serves Whisper transcription
 * in app/api/interview/transcribe/route.ts — one key, one account, one bill.
 */
export class GroqProvider implements AIProvider {
  private client: OpenAI
  private model: string

  constructor() {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      throw new Error(
        'GROQ_API_KEY is not set. Add it to .env.local — get a free key at https://console.groq.com/keys'
      )
    }

    this.client = new OpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey,
    })
    this.model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'
  }

  /**
   * @param temperature Sampling randomness. Left at the API default (1.0) for
   *   calls whose job is to *write* something, where variety is wanted — two
   *   candidates should not receive word-for-word identical questions. Pinned to
   *   0 by callers whose job is to *measure* something; see GRADING_TEMPERATURE.
   */
  private async generate(system: string, user: string, temperature?: number): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      // Groq honours OpenAI's JSON mode. The word "JSON" must appear in the
      // prompt for the API to accept this flag; every prompt in lib/prompts
      // already instructs the model to return JSON.
      response_format: { type: 'json_object' },
      ...(temperature === undefined ? {} : { temperature }),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })
    return completion.choices[0].message.content ?? '{}'
  }

  async generateQuestion(context: InterviewContext): Promise<Question> {
    const systemPrompt = getInterviewerSystemPrompt(
      context.round_type,
      context.company_name,
      context.role_name,
      context.resume_text.substring(0, RESUME_CHARS_QUESTION),
      context.jd_text.substring(0, 800),
      context.gap_matrix.recommended_focus_areas
    )
    const currentPlan = context.question_plan.planned_questions[context.current_question_index]
    const historyText = context.conversation_history
      .slice(-3)
      .map(t => `Q: ${t.question}\nA: ${t.answer}`)
      .join('\n\n')

    // Model 1 picks the topic; the LLM only writes the question. When the chooser is
    // unavailable this falls through to the static plan, which is the behaviour that
    // shipped before Phase 5 — the interview never depends on the controller.
    //
    // The tag is stated explicitly so the answer comes back tagged with the topic that
    // was *chosen*. Without that the LLM invents its own tags, `recordAnswer` matches
    // none of them, and the scorecard silently stops updating — the controller would be
    // steering a scorecard its own questions never move.
    const directive = context.chosen_topic
      ? `Topic to ask about: ${context.chosen_topic}\n` +
        `Difficulty: ${context.chosen_difficulty ?? 'medium'}\n` +
        `Set "question_tags" to exactly ["${context.chosen_topic}"].\n`
      : `Category: ${currentPlan?.category}\nTags: ${currentPlan?.question_tags.join(', ')}\n`

    const text = await this.generate(
      systemPrompt,
      `History: ${historyText || 'None'}\n${directive}\nReturn JSON only.`
    )
    const parsed = parseJSON<{
      message: string
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
      conversation_history: historyText || 'None',
      claims_history: context.claims_history.join(', ') || 'none',
    })

    const text = await this.generate(
      'Expert interview evaluator. Return JSON only.',
      prompt,
      GRADING_TEMPERATURE
    )
    // Scores are computed from the itemised worksheet rather than taken from the
    // model, so the number and its justification cannot disagree. See reconcile.ts.
    return reconcileEvaluation(parseJSON<Record<string, unknown>>(text))
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
      context.resume_text.substring(0, RESUME_CHARS_FOLLOWUP),
      context.jd_text.substring(0, 400),
      context.gap_matrix.recommended_focus_areas
    )
    const text = await this.generate(
      systemPrompt,
      `Answer: "${answer}"\nClaim: "${claim}"\nGenerate a probing follow-up question. Return JSON only.`
    )
    const parsed = parseJSON<{ message: string; question_tags: string[]; reasoning: string }>(text)
    return {
      content: parsed.message,
      question_type: 'follow_up',
      question_tags: parsed.question_tags,
      follow_up_trigger: false,
      reasoning: parsed.reasoning,
    }
  }

  async generateSessionReport(session: SessionData): Promise<SessionReport> {
    const transcriptText = session.transcript.map((t, i) => `Q${i + 1}: ${t.question}\nA: ${t.answer}`).join('\n\n')
    const prompt = interpolate(SESSION_REPORT_PROMPT, {
      company_name: session.company_name,
      role_name: session.role_name,
      round_type: session.round_type,
      overall_score: String(session.scores.overall_score ?? 0),
      transcript: transcriptText,
      scores: JSON.stringify(session.scores),
    })
    const text = await this.generate('Expert interview coach. Return JSON only.', prompt)
    return parseJSON<SessionReport>(text)
  }

  async parseResume(resumeText: string): Promise<ParsedResume> {
    const text = await this.generate(
      'Resume parser. Return JSON only.',
      `${RESUME_PARSER_PROMPT}\n\nResume:\n${resumeText}`,
      GRADING_TEMPERATURE
    )
    return parseJSON<ParsedResume>(text)
  }

  async buildGapMatrix(resumeSkills: string[], jdText: string): Promise<GapMatrix> {
    const jdText2 = await this.generate(
      'JD analyzer. Return JSON only.',
      `${JD_PARSER_PROMPT}\n\n${jdText}`,
      GRADING_TEMPERATURE
    )
    const jdParsed = parseJSON<{ required_skills: string[]; nice_to_have_skills: string[] }>(jdText2)
    const prompt = interpolate(GAP_MATRIX_PROMPT, {
      resume_skills: resumeSkills.join(', '),
      jd_required_skills: jdParsed.required_skills.join(', '),
      jd_nice_to_have_skills: jdParsed.nice_to_have_skills.join(', '),
    })
    const text = await this.generate('Skill gap analyzer. Return JSON only.', prompt, GRADING_TEMPERATURE)
    return parseJSON<GapMatrix>(text)
  }

  async extractJDFields(jdText: string): Promise<RawJDFields> {
    // Truncated: the metadata lives in the opening lines and the requirements list,
    // and sending 40k characters costs tokens without improving the answer.
    const text = await this.generate(
      'JD metadata extractor. Return JSON only.',
      `${JD_FIELDS_PROMPT}\n\nJob Description:\n${jdText.slice(0, 8000)}`,
      GRADING_TEMPERATURE
    )
    return parseJSON<RawJDFields>(text)
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
    const text = await this.generate('Interview planner. Return JSON only.', prompt)
    return parseJSON<QuestionPlan>(text)
  }

  /**
   * Classifies each line of the CV against what the candidate actually
   * demonstrated: validated, contradicted, or never explored.
   *
   * Not part of the AIProvider interface and not yet called by any route — it
   * was written for Gemini and moved here when the other providers were
   * removed, so that deleting them did not delete the work. Wiring it to a
   * screen is the outstanding "resume improvement suggestions" task.
   */
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

    const text = await this.generate('Resume analyst. Return JSON only.', prompt, GRADING_TEMPERATURE)
    return parseJSON(text)
  }
}
