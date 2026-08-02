'use client'

/**
 * "Use my own job description" — the front end for POST /api/jd/custom.
 *
 * Three ways in, because they fail in different ways and none of them is reliable
 * alone: pasting always works but is tedious; a file is convenient but can be a scanned
 * image with no text in it; a link is the least effort but the big job boards block
 * automated access outright. Paste is the default tab for exactly that reason — it is
 * the one that cannot fail — and every error message from the server points back to it.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { JobDescription } from '@/types'
import { FilePlus2, Link2, Loader2, Upload, ClipboardType } from 'lucide-react'
import { toast } from 'sonner'

type Tab = 'paste' | 'file' | 'url'

interface Props {
  onCreated: (jd: JobDescription) => void
}

const TABS: Array<{ id: Tab; label: string; icon: typeof ClipboardType }> = [
  { id: 'paste', label: 'Paste text', icon: ClipboardType },
  { id: 'file', label: 'Upload file', icon: Upload },
  { id: 'url', label: 'Job link', icon: Link2 },
]

export function CustomJDPanel({ onCreated }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('paste')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setText(''); setUrl(''); setFile(null); setTab('paste')
  }

  const submit = async () => {
    setBusy(true)
    try {
      let res: Response
      if (tab === 'file') {
        if (!file) { toast.error('Choose a file first'); return }
        const form = new FormData()
        form.append('file', file)
        res = await fetch('/api/jd/custom', { method: 'POST', body: form })
      } else {
        const payload = tab === 'paste' ? { jd_text: text } : { jd_url: url.trim() }
        res = await fetch('/api/jd/custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      const { data, error } = await res.json()
      if (error || !data) {
        // The server's message is the useful one — it distinguishes "that board blocks
        // us, paste it instead" from "that file had no readable text". Showing a generic
        // failure here would throw away the only actionable part.
        toast.error(error ?? 'Could not save that job description')
        return
      }

      if (data.fields_source === 'heuristic') {
        toast.warning('Saved, but the AI was unavailable — company and role were guessed from the text.')
      } else {
        toast.success(`Saved: ${data.jd.role_subtype} at ${data.jd.company_name}`)
      }

      setOpen(false)
      reset()
      // Refresh so the new JD appears in the grid on the next visit, and hand it
      // straight back so the user can start immediately without hunting for it.
      router.refresh()
      onCreated(data.jd as JobDescription)
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    !busy &&
    ((tab === 'paste' && text.trim().length >= 80) ||
      (tab === 'url' && /^https?:\/\/\S+$/i.test(url.trim())) ||
      (tab === 'file' && !!file))

  return (
    <>
      <Button
        variant="outline"
        className="border-primary/40 text-primary hover:bg-primary/10 gap-2"
        onClick={() => setOpen(true)}
      >
        <FilePlus2 className="w-4 h-4" /> Use my own JD
      </Button>

      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="sm:max-w-xl border-white/10">
          <DialogHeader>
            <DialogTitle>Use your own job description</DialogTitle>
            <DialogDescription>
              It gets compared against your resume, and the interview is built around the
              gaps between them.
            </DialogDescription>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex gap-2">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  tab === id
                    ? 'bg-primary border-primary text-white'
                    : 'border-white/20 text-slate-400 hover:border-primary/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === 'paste' && (
            <div className="space-y-2">
              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste the full job posting here — responsibilities, requirements, everything."
                className="min-h-48 bg-card border-white/10 resize-none"
              />
              <p className="text-xs text-slate-500">
                {text.trim().length < 80
                  ? `${80 - text.trim().length} more characters needed`
                  : `${text.trim().length.toLocaleString()} characters`}
              </p>
            </div>
          )}

          {tab === 'file' && (
            <div className="space-y-2">
              <label className="flex flex-col items-center justify-center gap-2 h-40 rounded-xl border border-dashed border-white/20 hover:border-primary/50 cursor-pointer transition-colors">
                <Upload className="w-6 h-6 text-slate-500" />
                <span className="text-sm text-slate-400">
                  {file ? file.name : 'Choose a PDF, Word or text file'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="text-xs text-slate-500">
                Up to 5MB. A scanned image of a JD has no readable text in it — paste the
                text instead if that is what you have.
              </p>
            </div>
          )}

          {tab === 'url' && (
            <div className="space-y-2">
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://boards.greenhouse.io/company/jobs/123"
                className="bg-card border-white/10"
              />
              <p className="text-xs text-slate-500">
                Works on company careers pages, Greenhouse and Lever.{' '}
                <span className="text-yellow-400/80">
                  LinkedIn and Indeed block automated access
                </span>{' '}
                — for those, copy the text and use the Paste tab.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canSubmit} className="gap-2 min-w-32">
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Reading…
                </>
              ) : (
                'Save & continue'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
