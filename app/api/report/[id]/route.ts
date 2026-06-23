import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ApiResponse } from '@/types'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: session_id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Unauthorized' }, { status: 401 })
    }

    const [
      { data: session },
      { data: scores },
      { data: messages },
      { data: markers },
      { data: speechFeedback },
    ] = await Promise.all([
      supabase
        .from('sessions')
        .select('*, job_descriptions(*), resumes(*)')
        .eq('id', session_id)
        .eq('user_id', user.id)
        .single(),
      supabase.from('session_scores').select('*').eq('session_id', session_id).single(),
      supabase
        .from('messages')
        .select('*')
        .eq('session_id', session_id)
        .order('timestamp', { ascending: true }),
      supabase.from('resume_markers').select('*').eq('session_id', session_id),
      supabase.from('speech_feedback').select('*').eq('session_id', session_id).single(),
    ])

    if (!session) {
      return NextResponse.json<ApiResponse<null>>({ data: null, error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json<ApiResponse<{
      session: typeof session
      scores: typeof scores
      messages: typeof messages
      markers: typeof markers
      speech_feedback: typeof speechFeedback
    }>>({
      data: { session, scores, messages: messages ?? [], markers: markers ?? [], speech_feedback: speechFeedback },
      error: null,
    })
  } catch (err) {
    console.error('Report fetch error:', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
