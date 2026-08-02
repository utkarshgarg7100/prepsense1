/**
 * POST /api/jd/custom — save a job description the user supplied themselves.
 *
 * Accepts three inputs, in one of two encodings:
 *   - JSON  { jd_text }  or  { jd_url }
 *   - multipart form-data with `file` (PDF / DOCX / plain text)
 *
 * The row lands in `job_descriptions` alongside the seeded library, owned by the user
 * (migration 010). Everything downstream — `/api/interview/start`, the report, the
 * percentile function — then treats it exactly like a seeded JD, which is the whole
 * reason it is not a separate table.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { cleanPastedJD, extractJDFromFile, extractJDFromURL, JDExtractionError } from '@/lib/jd/extract'
import { extractJDFields } from '@/lib/jd/fields'
import type { ApiResponse, JobDescription } from '@/types'

const BodySchema = z
  .object({
    jd_text: z.string().optional(),
    jd_url: z.string().optional(),
  })
  .refine(b => Boolean(b.jd_text?.trim() || b.jd_url?.trim()), {
    message: 'Provide the job description text or a link to it.',
  })

const MAX_FILE_BYTES = 5 * 1024 * 1024

function fail(error: string, status: number) {
  return NextResponse.json<ApiResponse<null>>({ data: null, error }, { status })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // No dev-bypass branch here, unlike the older routes. This route writes a row whose
    // RLS policy is `auth.uid() = user_id`, so a service-role write on behalf of a fake
    // dev user would create a JD nobody can subsequently read.
    if (!user) return fail('Unauthorized', 401)

    // ── Get the JD text, whichever way it arrived ──────────────────────────
    const contentType = request.headers.get('content-type') ?? ''
    let jdText: string
    let sourceKind: 'paste' | 'url' | 'file'
    let sourceRef: string | null = null

    try {
      if (contentType.includes('multipart/form-data')) {
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) return fail('No file provided', 400)
        if (file.size > MAX_FILE_BYTES) return fail('File size must be under 5MB', 400)
        jdText = await extractJDFromFile(file)
        sourceKind = 'file'
        sourceRef = file.name
      } else {
        const parsed = BodySchema.safeParse(await request.json())
        if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid request', 400)

        if (parsed.data.jd_text?.trim()) {
          jdText = cleanPastedJD(parsed.data.jd_text)
          sourceKind = 'paste'
        } else {
          sourceRef = parsed.data.jd_url!.trim()
          jdText = await extractJDFromURL(sourceRef)
          sourceKind = 'url'
        }
      }
    } catch (err) {
      // Extraction failures are the user's normal path, not exceptions: a blocked job
      // board, a scanned PDF, a dead link. They get their own message and a 400, so the
      // UI can tell them to paste the text instead.
      if (err instanceof JDExtractionError) return fail(err.message, 400)
      throw err
    }

    if (jdText.trim().length < 80) {
      return fail('That job description looks too short. Paste the full posting.', 400)
    }

    // ── Recover the metadata the seeded JDs come with ──────────────────────
    // Never throws; falls back to heuristics if the model is unavailable.
    const fields = await extractJDFields(jdText)

    // ── Save ───────────────────────────────────────────────────────────────
    // `job_descriptions.id` is TEXT (migration 003) and has no default, so the id is
    // generated here. The `custom-` prefix makes a user's JD identifiable in the
    // database without joining, which matters when reading rl_experience by hand.
    const id = `custom-${crypto.randomUUID()}`

    const { data: jd, error: insertError } = await supabase
      .from('job_descriptions')
      .insert({
        id,
        user_id: user.id,
        role_type: fields.role_type,
        role_subtype: fields.role_subtype,
        company_name: fields.company_name,
        company_tier: fields.company_tier,
        industry: fields.industry,
        seniority: fields.seniority,
        jd_text: jdText,
        required_skills: fields.required_skills,
        nice_to_have_skills: fields.nice_to_have_skills,
        culture_tags: fields.culture_tags,
        is_sample: false,
      })
      .select()
      .single()

    if (insertError || !jd) {
      console.error('Custom JD insert failed:', insertError?.message)
      return fail(insertError?.message ?? 'Failed to save the job description', 500)
    }

    console.info(`custom JD ${id} saved for ${user.id} (via ${sourceKind}${sourceRef ? `: ${sourceRef}` : ''}, fields: ${fields.source})`)

    return NextResponse.json<ApiResponse<{
      jd: JobDescription
      /** 'heuristic' means the model was unavailable and the metadata is a guess. */
      fields_source: 'llm' | 'heuristic'
      extracted_from: 'paste' | 'url' | 'file'
    }>>({
      data: { jd: jd as JobDescription, fields_source: fields.source, extracted_from: sourceKind },
      error: null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Custom JD error:', msg)
    return fail('Something went wrong saving that job description.', 500)
  }
}

/** DELETE /api/jd/custom?id=… — remove one of the user's own JDs. */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fail('Unauthorized', 401)

    const id = request.nextUrl.searchParams.get('id')
    if (!id) return fail('Missing id', 400)

    // `.eq('user_id', user.id)` is belt-and-braces on top of the RLS delete policy:
    // both must agree before a row goes. A seeded JD has user_id NULL and so can never
    // match, which is what stops a stray request deleting the shared library.
    const { error } = await supabase
      .from('job_descriptions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) return fail(error.message, 500)
    return NextResponse.json<ApiResponse<{ deleted: string }>>({ data: { deleted: id }, error: null })
  } catch (err) {
    console.error('Custom JD delete error:', err)
    return fail('Something went wrong.', 500)
  }
}
