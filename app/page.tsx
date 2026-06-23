import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, Zap, Target, BarChart3, Mic, Brain, Trophy } from 'lucide-react'

export default function HomePage() {
  return (
    <div className="min-h-screen gradient-bg flex flex-col">
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-xl text-white">PrepSense</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login"><Button variant="ghost" className="text-slate-300 hover:text-white">Sign in</Button></Link>
            <Link href="/signup"><Button className="bg-primary hover:bg-primary/90">Get started free</Button></Link>
          </div>
        </div>
      </nav>
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <Badge className="mb-6 bg-primary/20 text-primary border-primary/30 px-4 py-1.5">
          <Zap className="w-3 h-3 mr-1" />AI-Powered Interview Coaching
        </Badge>
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight max-w-4xl">
          Interview like you&apos;ve<span className="text-primary"> done it 100 times</span>
        </h1>
        <p className="text-xl text-slate-400 mb-10 max-w-2xl">
          PrepSense simulates real interviews with AI personas — Technical, Founders, HR. Get scored, get feedback, get the offer.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link href="/signup"><Button size="lg" className="bg-primary hover:bg-primary/90 text-lg px-8 h-14 gap-2">Start practising free <ArrowRight className="w-5 h-5" /></Button></Link>
          <Link href="/login"><Button size="lg" variant="outline" className="border-white/20 text-slate-300 hover:text-white hover:bg-white/10 text-lg px-8 h-14">Sign in</Button></Link>
        </div>
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
          {[
            { icon: Target, title: 'JD-Matched Questions', desc: 'Upload a job description and get interview questions crafted specifically for that role and company.' },
            { icon: BarChart3, title: 'Real-Time Scoring', desc: 'Get scored on STAR compliance, technical depth, ownership signals, and 15+ more metrics per answer.' },
            { icon: Mic, title: 'Voice Mode', desc: 'Practice speaking your answers. Whisper transcribes, Priya pushes back, and you get filler word analysis.' },
            { icon: Brain, title: 'AI Personas', desc: 'Alex (Technical), Priya (Founders), and Rohan (HR) each have distinct styles and push you differently.' },
            { icon: Trophy, title: 'Track Progress', desc: 'Streaks, badges, percentile rankings, and score charts show your improvement over time.' },
            { icon: Zap, title: 'Resume Feedback', desc: 'After each session, see exactly which resume lines are vague, strong, or never defended.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 text-left hover:border-primary/30 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-white mb-2">{title}</h3>
              <p className="text-sm text-slate-400">{desc}</p>
            </div>
          ))}
        </div>
      </main>
      <footer className="border-t border-white/10 px-6 py-6 text-center text-sm text-slate-500">
        © 2025 PrepSense. Built for ambitious candidates.
      </footer>
    </div>
  )
}
