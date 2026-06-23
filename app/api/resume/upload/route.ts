import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { ApiResponse } from '@/types'

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

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'No file provided' },
        { status: 400 }
      )
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'Only PDF files are supported' },
        { status: 400 }
      )
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'File size must be under 5MB' },
        { status: 400 }
      )
    }

    const serviceSupabase = await createServiceClient()

    // Upload to Supabase Storage
    const fileName = `${user.id}/${Date.now()}-resume.pdf`
    const { error: uploadError } = await serviceSupabase.storage
      .from('resumes')
      .upload(fileName, file, { contentType: 'application/pdf' })

    if (uploadError) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'Failed to upload file' },
        { status: 500 }
      )
    }

    const { data: urlData } = serviceSupabase.storage
      .from('resumes')
      .getPublicUrl(fileName)

    // Parse PDF text server-side
    let parsedText = ''
    try {
      const pdfParse = (await import('pdf-parse')).default
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const pdfData = await pdfParse(buffer)
      parsedText = pdfData.text
    } catch (pdfErr) {
      console.error('PDF parse error:', pdfErr)
      // Continue with empty text — user can manually trigger re-parse
    }

    // Deactivate existing active resumes
    await supabase
      .from('resumes')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true)

    // Create resume record
    const { data: resumeRecord, error: dbError } = await supabase
      .from('resumes')
      .insert({
        user_id: user.id,
        file_url: urlData.publicUrl,
        parsed_text: parsedText,
        is_active: true,
      })
      .select()
      .single()

    if (dbError) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: 'Failed to save resume record' },
        { status: 500 }
      )
    }

    return NextResponse.json<ApiResponse<{ resume_id: string; has_text: boolean }>>({
      data: { resume_id: resumeRecord.id, has_text: parsedText.length > 100 },
      error: null,
    })
  } catch (err) {
    console.error('Upload error:', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
