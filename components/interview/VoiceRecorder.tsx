'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, MicOff, Send, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  onTranscript: (text: string) => void
  onSubmit: (text: string) => void
  disabled?: boolean
}

export function VoiceRecorder({ onTranscript, onSubmit, disabled }: Props) {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [bars] = useState(() => Array.from({ length: 20 }, (_, i) => i))
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = handleRecordingStop
      recorder.start(250)
      mediaRef.current = recorder
      setIsRecording(true)
    } catch {
      toast.error('Microphone access denied')
    }
  }

  const stopRecording = () => {
    mediaRef.current?.stop()
    mediaRef.current?.stream.getTracks().forEach(t => t.stop())
    setIsRecording(false)
  }

  const handleRecordingStop = async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    setTranscribing(true)

    const formData = new FormData()
    formData.append('audio', blob, 'recording.webm')

    const res = await fetch('/api/interview/transcribe', { method: 'POST', body: formData })
    const { data, error } = await res.json()
    setTranscribing(false)

    if (error || !data?.text) {
      toast.error('Transcription failed. Please type your answer instead.')
      return
    }

    setTranscript(data.text)
    onTranscript(data.text)
  }

  const handleSubmit = () => {
    if (transcript.trim()) onSubmit(transcript)
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6">
      {/* Waveform visualization */}
      <div className="flex items-center gap-0.5 h-16">
        {bars.map(i => (
          <div
            key={i}
            className={`w-1.5 rounded-full bg-primary transition-all ${
              isRecording ? 'wave-bar' : 'h-2 opacity-30'
            }`}
            style={isRecording ? { animationDelay: `${i * 0.05}s` } : undefined}
          />
        ))}
      </div>

      {/* Record button */}
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled || transcribing}
        className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-xl ${
          isRecording
            ? 'bg-rose-500 hover:bg-rose-600 scale-110 ring-4 ring-rose-500/30'
            : 'bg-primary hover:bg-primary/90'
        } disabled:opacity-50`}
      >
        {transcribing ? (
          <Loader2 className="w-7 h-7 animate-spin text-white" />
        ) : isRecording ? (
          <MicOff className="w-7 h-7 text-white" />
        ) : (
          <Mic className="w-7 h-7 text-white" />
        )}
      </button>

      <p className="text-sm text-slate-400">
        {transcribing ? 'Transcribing...' : isRecording ? 'Recording... tap to stop' : 'Tap to start recording'}
      </p>

      {/* Transcript */}
      {transcript && (
        <div className="w-full rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">{transcript}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-white/20 hover:bg-white/10 text-slate-400"
              onClick={() => { setTranscript(''); onTranscript('') }}
            >
              Re-record
            </Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 gap-1.5 flex-1"
              onClick={handleSubmit}
              disabled={disabled}
            >
              <Send className="w-3.5 h-3.5" /> Submit Answer
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
