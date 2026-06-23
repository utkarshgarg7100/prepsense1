'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Upload, FileText, CheckCircle2, Loader2, Trash2 } from 'lucide-react'
import type { Resume } from '@/types'
import { useRouter } from 'next/navigation'

interface Props {
  resumes: Resume[]
  userId: string
}

export function ResumeManager({ resumes: initial, userId }: Props) {
  const router = useRouter()
  const [resumes, setResumes] = useState<Resume[]>(initial)
  const [uploading, setUploading] = useState(false)
  const [parsing, setParsing] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File) => {
    if (!file.type.includes('pdf')) {
      toast.error('Only PDF files are supported')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File must be under 5MB')
      return
    }

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/resume/upload', { method: 'POST', body: formData })
    const { data, error } = await res.json()
    setUploading(false)

    if (error || !data) {
      toast.error(error ?? 'Upload failed')
      return
    }

    toast.success('Resume uploaded! Parsing skills...')
    setResumes(prev => [data.resume, ...prev.map(r => ({ ...r, is_active: false }))])

    // Auto-parse
    setParsing(data.resume.id)
    const parseRes = await fetch('/api/resume/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume_id: data.resume.id }),
    })
    const { error: parseError } = await parseRes.json()
    setParsing(null)

    if (parseError) {
      toast.error('Parsing failed — you can still use this resume')
    } else {
      toast.success('Resume parsed and ready!')
      router.refresh()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-200">Resumes</h2>
        <Button
          size="sm"
          className="bg-primary hover:bg-primary/90 gap-2"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload PDF
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
      </div>

      {/* Drop zone */}
      <div
        className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-primary/30 transition-colors cursor-pointer"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault() }}
        onDrop={e => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) handleUpload(file)
        }}
      >
        <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
        <p className="text-sm text-slate-400">Drag & drop your resume PDF here</p>
        <p className="text-xs text-slate-600 mt-1">Max 5MB · PDF only</p>
      </div>

      {/* Resume list */}
      {resumes.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-4">No resumes yet — upload one to get personalised questions</p>
      ) : (
        <div className="space-y-2">
          {resumes.map(resume => (
            <div
              key={resume.id}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                resume.is_active ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-card'
              }`}
            >
              <FileText className="w-5 h-5 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium truncate">{resume.file_name}</span>
                  {resume.is_active && (
                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Active
                    </Badge>
                  )}
                  {parsing === resume.id && (
                    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-xs flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Parsing...
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(resume.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                  {resume.extracted_skills?.length
                    ? ` · ${resume.extracted_skills.length} skills extracted`
                    : ''}
                </span>
              </div>
              {!resume.is_active && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
