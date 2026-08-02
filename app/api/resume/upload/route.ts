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
        { data: null, error: `Failed to upload file: ${uploadError.message}` },
        { status: 500 }
      )
    }

    const { data: urlData } = serviceSupabase.storage
      .from('resumes')
      .getPublicUrl(fileName)

    // Parse PDF text server-side
    let parsedText = ''
    try {
      // pdf-parse v2 replaced the default-export function with a PDFParse class;
      // the old `pdfParse(buffer)` call silently no longer exists.
      const { PDFParse } = await import('pdf-parse')
      const arrayBuffer = await file.arrayBuffer()
      const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) })
      try {
        const pdfData = await parser.getText()
        parsedText = pdfData.text ?? ''
      } finally {
        // Releases the underlying worker; without this the route leaks one per upload.
        await parser.destroy()
      }
    } catch (pdfErr) {
      console.error('PDF parse error:', pdfErr)
      // Continue with empty text — AI parse step can still extract from URL
    }

    // Deactivate existing active resumes
    await supabase
      .from('resumes')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true)

    // Create resume record
    const { data: resume, error: dbError } = await supabase
      .from('resumes')
      .insert({
        user_id: user.id,
        file_url: urlData.publicUrl,
        file_name: file.name,
        parsed_text: parsedText,
        is_active: true,
      })
      .select()
      .single()

    if (dbError) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, error: `Failed to save resume record: ${dbError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ data: { resume }, error: null })
  } catch (err) {
    console.error('Upload error:', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
