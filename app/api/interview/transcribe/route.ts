import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const audio = formData.get('audio') as File | null
    if (!audio) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'whisper-1',
      language: 'en',
    })

    return NextResponse.json({ data: { text: transcription.text } })
  } catch (err: any) {
    console.error('Transcription error:', err)
    return NextResponse.json({ error: err.message ?? 'Transcription failed' }, { status: 500 })
  }
}
