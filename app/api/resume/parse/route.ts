import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getAIProvider } from '@/lib/ai/router'
import { compareWithLLM, type ParserAgreement } from '@/lib/parse/agreement'
import {
  explainTopic,
  gapVector,
  parseResumeAndJD,
  toPriors,
  weakestTopics,
} from '@/lib/parse/parser'
import type { ApiResponse, ParsedResume, ResumeGapAnalysis } from '@/types'

const ParseResumeSchema = z.object({
  resume_id: z.string().uuid(),
  // Optional: with a JD the parser produces a real gap vector; without one it can
  // still report which topics the resume evidences, which is what upload-time
  // parsing needs before the user has picked a job.
  jd_id: z.string().uuid().optional(),
})

export interface ParseResumeResult {
  parsed: ParsedResume | null
  gap_analysis: ResumeGapAnalysis
  /** Whether the LLM enrichment ran, so callers can tell a degraded result apart. */
  source: 'classical' | 'classical+llm'
  agreement: ParserAgreement | null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const parsed = ParseResumeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: parsed.error.message },
        { status: 400 }
      )
    }

    const { resume_id, jd_id } = parsed.data

    const { data: resume, error: resumeError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', resume_id)
      .eq('user_id', user.id)
      .single()

    if (resumeError || !resume) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'Resume not found' },
        { status: 404 }
      )
    }

    let jdText = ''
    if (jd_id) {
      const { data: jd } = await supabase
        .from('job_descriptions')
        .select('jd_text')
        .eq('id', jd_id)
        .single()
      jdText = jd?.jd_text ?? ''
    }

    // Model 5 runs first and unconditionally: it is local, deterministic and free,
    // so the endpoint has a useful answer even when the AI provider is down or rate
    // limited. The LLM below only adds structure the classical parser cannot produce.
    const classical = parseResumeAndJD(resume.parsed_text, jdText)
    const weakest = weakestTopics(classical, 5)
    const gapAnalysis: ResumeGapAnalysis = {
      topics: [...classical.topics],
      gaps: gapVector(classical),
      priors: toPriors(classical),
      weakest_topics: weakest,
      explanations: weakest.map(topic => explainTopic(classical, topic)),
    }

    // Skills the classical parser can defend: lexicon keywords actually present in
    // the documents. Deduplicated across topics, since keywords overlap by design.
    const classicalSkills = Array.from(
      new Set(classical.topics.flatMap(t => classical.matchedTerms[t] ?? []))
    )

    let llm: ParsedResume | null = null
    let agreement: ParserAgreement | null = null
    try {
      const ai = await getAIProvider()
      llm = await ai.parseResume(resume.parsed_text)
      agreement = compareWithLLM(classical, llm.skills ?? [])
      console.info(
        `resume ${resume_id}: parser agreement ${(agreement.overlap * 100).toFixed(0)}% ` +
        `(classical ${agreement.classical_top.join('/')} vs llm ${agreement.llm_top.join('/')})`
      )
    } catch (llmError) {
      // Degraded, not failed. Structured experience/education/projects go missing,
      // but skills and the gap vector — the parts the interview actually consumes —
      // are already in hand.
      console.warn('LLM resume parse failed; using classical parser only:', llmError)
    }

    const { error: updateError } = await supabase
      .from('resumes')
      .update({
        extracted_skills: llm?.skills?.length ? llm.skills : classicalSkills,
        extracted_experience: llm?.experience ?? [],
        extracted_education: llm?.education ?? [],
        extracted_projects: llm?.projects ?? [],
        parsed_at: new Date().toISOString(),
      })
      .eq('id', resume_id)

    if (updateError) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'Failed to save parsed resume' },
        { status: 500 }
      )
    }

    return NextResponse.json<ApiResponse<ParseResumeResult>>({
      data: {
        parsed: llm,
        gap_analysis: gapAnalysis,
        source: llm ? 'classical+llm' : 'classical',
        agreement,
      },
      error: null,
    })
  } catch (err) {
    console.error('Resume parse error:', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
