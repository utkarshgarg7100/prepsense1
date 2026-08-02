import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

// Groq serves Whisper on an OpenAI-compatible endpoint and is free within the
// 2,000 req/day tier, so the same key that powers answer scoring also covers
// transcription. The `openai` SDK is used only as the HTTP client for it.
//
// There is deliberately no fallback to OpenAI. The previous version silently
// switched to OpenAI (and billed for it) whenever GROQ_API_KEY was missing,
// which turns a configuration mistake into a charge rather than an error.
const client = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
})

const whisperModel = process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3-turbo'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const audio = formData.get('audio') as File | null
    if (!audio) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

    // Whisper is trained on cleaned-up captions, so by default it silently deletes
    // disfluencies ("um", "uh", stutters). That made the report's filler-word count
    // always come back at ~0. The `prompt` parameter conditions the decoder's style:
    // a prompt that is itself full of fillers biases it toward a verbatim transcript.
    // temperature 0 keeps it from "tidying" the output on a resample.
    const transcription = await client.audio.transcriptions.create({
      file: audio,
      model: whisperModel,
      language: 'en',
      temperature: 0,
      prompt:
        'Umm, so, uh, like — I guess what I would say is, you know, basically, ' +
        'I mean, uh, transcribe every word exactly as spoken including hesitations.',
    })

    return NextResponse.json({ data: { text: transcription.text } })
  } catch (err: any) {
    console.error('Transcription error:', err)
    return NextResponse.json({ error: err.message ?? 'Transcription failed' }, { status: 500 })
  }
}
