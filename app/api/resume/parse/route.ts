import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getAIProvider } from '@/lib/ai/router'
import type { ApiResponse, ParsedResume } from '@/types'

const ParseResumeSchema = z.object({
  resume_id: z.string().uuid(),
})

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

    const { resume_id } = parsed.data

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

    const ai = await getAIProvider()
    const parsedResume: ParsedResume = await ai.parseResume(resume.parsed_text)

    const { error: updateError } = await supabase
      .from('resumes')
      .update({
        extracted_skills: parsedResume.skills,
        extracted_experience: parsedResume.experience,
        extracted_education: parsedResume.education,
        extracted_projects: parsedResume.projects,
        parsed_at: new Date().toISOString(),
      })
      .eq('id', resume_id)

    if (updateError) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'Failed to save parsed resume' },
        { status: 500 }
      )
    }

    return NextResponse.json<ApiResponse<ParsedResume>>({ data: parsedResume, error: null })
  } catch (err) {
    console.error('Resume parse error:', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
