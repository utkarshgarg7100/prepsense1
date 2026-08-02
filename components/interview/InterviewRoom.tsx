'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Mic, MicOff, Send, Clock, X, ChevronRight, Loader2 } from 'lucide-react'
import type { Message, AnswerEvaluation, GapMatrix, QuestionPlan, RoundType } from '@/types'
import { VoiceRecorder } from './VoiceRecorder'
import { InterviewerAvatar } from './InterviewerAvatar'
import { ScorePill } from './ScorePill'
import { ScoreBreakdownPanel } from '@/components/report/ScoreBreakdown'

interface Props {
  session: {
    id: string
    round_type: RoundType
    status: string
  }
  initialMessages: Message[]
  jd: { company_name: string; role_subtype: string } | null
  questionPlan: QuestionPlan | null
  gapMatrix: GapMatrix | null
}

const ROUND_PERSONAS: Record<RoundType, { name: string; color: string }> = {
  technical: { name: 'Alex', color: 'text-blue-400' },
  founders: { name: 'Priya', color: 'text-purple-400' },
  hr: { name: 'Rohan', color: 'text-emerald-400' },
}

export function InterviewRoom({ session, initialMessages, jd, questionPlan }: Props) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [isVoiceMode, setIsVoiceMode] = useState(false)
  const [questionIndex, setQuestionIndex] = useState(
    Math.floor(initialMessages.filter(m => m.role === 'interviewer').length) - 1
  )
  const [timer, setTimer] = useState(0)
  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [lastEval, setLastEval] = useState<AnswerEvaluation | null>(null)
  const [isComplete, setIsComplete] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [sessionStart] = useState(Date.now())
  const [restoredDraft, setRestoredDraft] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Answers in progress are kept in the browser, keyed by session and question.
  //
  // Everything else here survives a reload already, because messages and mastery are
  // written server-side per answer — but the answer *being typed* existed only in React
  // state, so a stray Back click, a refresh or a closed tab destroyed minutes of work
  // with no way to recover it. localStorage rather than the database on purpose: this
  // saves on every keystroke, and a draft is worth nothing once submitted.
  const draftKey = `prepsense:draft:${session.id}:${questionIndex}`

  const totalQuestions = questionPlan?.total_questions ?? 12
  const currentQuestion = messages.filter(m => m.role === 'interviewer').at(-1)
  const persona = ROUND_PERSONAS[session.round_type]
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!isTimerRunning) return
    const interval = setInterval(() => setTimer(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isTimerRunning])

  useEffect(() => {
    if (currentQuestion && !isVoiceMode) {
      setIsTimerRunning(true)
      textareaRef.current?.focus()
    }
  }, [currentQuestion, isVoiceMode])

  // Restore a draft for this question, if one was left behind.
  useEffect(() => {
    const saved = window.localStorage.getItem(draftKey)
    if (saved) {
      setAnswer(saved)
      setRestoredDraft(true)
    }
    // Keyed on the question, so moving to the next one clears the restored-notice.
  }, [draftKey])

  // Save on every change, debounced. Writing synchronously on each keystroke is
  // wasteful; waiting longer than this risks losing the last sentence typed before a
  // navigation, which is the case this exists for.
  useEffect(() => {
    if (!answer) return
    const timeout = setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey, answer)
      } catch {
        // Quota exceeded or storage disabled (private browsing). Losing the draft is
        // bad; taking down the interview over it would be worse.
      }
    }, 400)
    return () => clearTimeout(timeout)
  }, [answer, draftKey])

  // The browser's own "are you sure" prompt. It is the only thing that can intercept a
  // Back click, a tab close or a reload — none of which React routing sees.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (answer.trim() && !submitting) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [answer, submitting])

  const handleSubmit = useCallback(async (submittedAnswer?: string) => {
    const text = submittedAnswer ?? answer
    if (!text.trim() || submitting) return

    setSubmitting(true)
    setIsTimerRunning(false)

    const res = await fetch('/api/interview/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        question: currentQuestion?.content ?? '',
        answer: text,
        question_type: currentQuestion?.question_type ?? 'general',
        question_tags: currentQuestion?.question_tags ?? [],
        question_index: questionIndex,
        time_taken_seconds: timer,
      }),
    })

    const { data, error } = await res.json()
    setSubmitting(false)

    if (error || !data) {
      toast.error('Failed to submit answer')
      return
    }

    // Update messages with candidate answer
    const candidateMsg: Message = {
      id: crypto.randomUUID(),
      session_id: session.id,
      role: 'candidate',
      content: text,
      timestamp: new Date().toISOString(),
      question_type: currentQuestion?.question_type ?? null,
      question_tags: currentQuestion?.question_tags ?? [],
      answer_evaluation: data.evaluation,
    }
    setLastEval(data.evaluation)
    setAnswer('')
    setTimer(0)
    setRestoredDraft(false)
    // Only once the answer is safely persisted server-side. Clearing earlier would open
    // a window where a failed request loses the text it was meant to protect.
    window.localStorage.removeItem(draftKey)

    const newMessages = [...messages, candidateMsg]

    if (data.is_complete) {
      setMessages(newMessages)
      setIsComplete(true)
      handleComplete(newMessages)
    } else if (data.next_question) {
      const nextMsg: Message = {
        id: crypto.randomUUID(),
        session_id: session.id,
        role: 'interviewer',
        content: data.next_question.content,
        timestamp: new Date().toISOString(),
        question_type: data.next_question.question_type,
        question_tags: data.next_question.question_tags,
        answer_evaluation: null,
      }
      setMessages([...newMessages, nextMsg])
      setQuestionIndex(data.next_question_index)
      setIsTimerRunning(true)
      if (isVoiceMode) speakQuestion(data.next_question.content)
    }
  }, [answer, submitting, session.id, currentQuestion, questionIndex, messages, timer, isVoiceMode, draftKey])

  const handleComplete = async (finalMessages: Message[]) => {
    setCompleting(true)
    const duration = Math.round((Date.now() - sessionStart) / 1000)

    const res = await fetch('/api/interview/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session.id, duration_seconds: duration }),
    })

    const { data, error } = await res.json()
    setCompleting(false)

    if (error) {
      toast.error('Failed to complete session')
      return
    }

    toast.success('Session complete! Generating your report...')
    setTimeout(() => router.push(`/report/${session.id}`), 1500)
  }

  const speakQuestion = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.9
    utterance.pitch = 1.0
    window.speechSynthesis.speak(utterance)
  }

  const formatTimer = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const timerColor =
    timer < 60 ? 'text-slate-400'
    : timer < 90 ? 'text-emerald-400'
    : timer < 120 ? 'text-yellow-400'
    : 'text-rose-400'

  if (completing || isComplete) {
    return (
      <div className="h-screen flex items-center justify-center gradient-bg">
        <div className="text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-white mb-2">Interview Complete!</h2>
          <p className="text-slate-400 mb-4">Generating your personalized report...</p>
          <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
        </div>
      </div>
    )
  }

  const answeredCount = messages.filter(m => m.role === 'candidate').length

  return (
    <div className="h-screen flex flex-col gradient-bg overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <InterviewerAvatar roundType={session.round_type} isSpeaking={submitting} />
          <div>
            <span className={`font-semibold ${persona.color}`}>{persona.name}</span>
            <span className="text-slate-400 text-sm ml-2">
              {jd?.company_name} · {session.round_type} round
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Badge className="bg-white/5 border-white/10 text-slate-300 text-xs">
            Q{answeredCount + 1} / {totalQuestions}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-rose-400"
            onClick={() => setShowExitDialog(true)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Question */}
        <div className="w-full lg:w-1/2 p-6 flex flex-col overflow-y-auto border-r border-white/10">
          <div className="flex-1 space-y-4">
            {messages.map((msg, i) => (
              <div key={msg.id ?? i}>
                {msg.role === 'interviewer' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${persona.color}`}>{persona.name}</span>
                      <span className="text-xs text-slate-500">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {msg.question_tags?.length > 0 && (
                        <Badge className="text-xs bg-white/5 border-white/10 text-slate-400 px-1.5 py-0">
                          {msg.question_tags[0]}
                        </Badge>
                      )}
                    </div>
                    <div className="text-base leading-relaxed text-white bg-white/5 rounded-xl p-4 border border-white/10">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="ml-8 space-y-1.5">
                    <span className="text-xs text-slate-500 font-semibold">You</span>
                    <div className="text-sm text-slate-300 bg-primary/10 rounded-xl p-3 border border-primary/20">
                      {msg.content}
                    </div>
                    {msg.answer_evaluation && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <ScorePill label="Depth" score={msg.answer_evaluation.depth_score} />
                        <ScorePill label="STAR" score={msg.answer_evaluation.star_compliance} />
                        {msg.answer_evaluation.consistency_flags?.length > 0 && (
                          <span className="text-xs text-yellow-400">⚠ Consistency flag</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Right: Answer input.
            `overflow-hidden` + `min-h-0` below are load-bearing, not decoration. A flex
            child defaults to min-height:auto, so it refuses to shrink below its content:
            once the "last answer summary" panel appeared, the column grew taller than the
            viewport and pushed the submit button off-screen with nothing scrollable to
            reach it. The answer was effectively unsubmittable. */}
        <div className="hidden lg:flex lg:w-1/2 flex-col p-6 overflow-hidden">
          {/* Timer */}
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className={`text-lg font-mono font-semibold ${timerColor}`}>
              {formatTimer(timer)}
            </span>
            <span className="text-xs text-slate-500">· Aim for 90-120 seconds</span>
          </div>

          {isVoiceMode ? (
            <VoiceRecorder
              onTranscript={text => setAnswer(text)}
              onSubmit={text => handleSubmit(text)}
              disabled={submitting}
            />
          ) : (
            <div className="flex-1 flex flex-col gap-3 min-h-0">
              <Textarea
                ref={textareaRef}
                placeholder="Type your answer here... Be specific, use examples, and structure with STAR (Situation, Task, Action, Result)."
                // min-h-0 lets it shrink; a long answer scrolls inside the box rather
                // than growing the column and displacing the controls below it.
                className="flex-1 min-h-0 overflow-y-auto bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm leading-relaxed resize-none"
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit()
                }}
                disabled={submitting}
              />

              {/* Word count + hints */}
              <div className="shrink-0 flex items-center justify-between text-xs text-slate-500">
                <span className={wordCount > 0 ? (
                  wordCount < 80 ? 'text-rose-400'
                  : wordCount <= 300 ? 'text-emerald-400'
                  : 'text-yellow-400'
                ) : ''}>
                  {wordCount > 0 ? `${wordCount} words` : 'Start typing...'}
                </span>
                <span>Ideal: 150-300 words · ⌘Enter to submit</span>
              </div>

              {restoredDraft && (
                <div className="shrink-0 flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-300">
                  <span>Restored the answer you were writing.</span>
                  <button
                    type="button"
                    className="text-emerald-200/70 hover:text-emerald-100 underline"
                    onClick={() => {
                      setAnswer('')
                      setRestoredDraft(false)
                      window.localStorage.removeItem(draftKey)
                    }}
                  >
                    Clear it
                  </button>
                </div>
              )}

              {/* Capped and independently scrollable: this panel is the one whose height
                  varies with the model's output, so left uncapped it is what pushes the
                  submit button out of reach. */}
              {lastEval && (
                <div className="shrink-0 max-h-32 overflow-y-auto rounded-lg bg-white/5 border border-white/10 p-3 text-xs text-slate-400">
                  <p className="font-semibold text-slate-300 mb-1">Last answer summary:</p>
                  <p>{lastEval.answer_summary}</p>
                  {lastEval.score_breakdown && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-primary hover:underline">
                        Why did I score {lastEval.depth_score} on depth?
                      </summary>
                      <div className="mt-2">
                        <ScoreBreakdownPanel
                          breakdown={lastEval.score_breakdown}
                          starScore={lastEval.star_compliance}
                          depthScore={lastEval.depth_score}
                        />
                      </div>
                    </details>
                  )}
                  {lastEval.strong_answer_example && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-primary hover:underline">Show strong answer example</summary>
                      <p className="mt-1 text-slate-300">{lastEval.strong_answer_example}</p>
                    </details>
                  )}
                </div>
              )}

              <Button
                className="shrink-0 bg-primary hover:bg-primary/90 gap-2 h-12"
                onClick={() => handleSubmit()}
                disabled={submitting || !answer.trim()}
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Evaluating...</>
                ) : (
                  <><Send className="w-4 h-4" /> Submit Answer <ChevronRight className="w-4 h-4" /></>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: progress + voice toggle */}
      <div className="border-t border-white/10 bg-black/20 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <span className="text-xs text-slate-400 whitespace-nowrap">{answeredCount}/{totalQuestions}</span>
          <Progress value={(answeredCount / totalQuestions) * 100} className="h-1.5 bg-white/10" />
        </div>
        <Button
          variant={isVoiceMode ? 'default' : 'outline'}
          size="sm"
          className={`ml-4 gap-2 ${isVoiceMode ? 'bg-rose-500 hover:bg-rose-600 border-rose-500' : 'border-white/20 hover:bg-white/10'}`}
          onClick={() => setIsVoiceMode(v => !v)}
        >
          {isVoiceMode ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
          {isVoiceMode ? 'Text Mode' : 'Voice Mode'}
        </Button>
      </div>

      {/* Exit dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent className="bg-card border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this interview?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              <span className="block mb-2">
                <strong className="text-slate-200">Pause</strong> keeps the session open — every
                answer you have given is already saved, and you can resume from your dashboard
                exactly where you left off.
              </span>
              <span className="block">
                <strong className="text-rose-300">End now</strong> closes the session for good and
                scores only what you have answered so far.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="border-white/20 hover:bg-white/10">Keep going</AlertDialogCancel>
            {/* Pause is deliberately the plain navigation: the session row stays
                `in_progress`, so nothing needs to be written for it to be resumable. */}
            <AlertDialogAction
              className="bg-white/10 hover:bg-white/20 border border-white/20"
              onClick={() => router.push('/dashboard')}
            >
              Pause &amp; exit
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                await fetch('/api/interview/complete', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    session_id: session.id,
                    duration_seconds: Math.round((Date.now() - sessionStart) / 1000),
                  }),
                })
                router.push('/dashboard')
              }}
            >
              End now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
