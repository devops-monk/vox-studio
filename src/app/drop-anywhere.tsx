import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { BookOpen, Copy, FileAudio, FileText, Film, Loader2, Mic, PenLine, Replace, Sparkles, Upload, X, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { formatBytes } from '@/lib/format'
import { useFocus } from '@/lib/store/focus'
import { useInbox } from '@/lib/store/inbox'
import { useStudio } from '@/lib/store/studio'
import { voxd } from '@/lib/voxd/client'
import { useDubLanguages } from '@/lib/voxd/queries'
import { cn } from '@/lib/cn'
import { create } from 'zustand'

type Kind = 'audio' | 'video' | 'book' | 'text' | 'other'
const AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg|opus|aiff?|caf)$/i
const VIDEO = /\.(mp4|mov|mkv|webm|m4v|avi)$/i
const BOOK = /\.(epub|docx)$/i
const TEXT = /\.(txt|md|markdown)$/i

export function kindOf(file: File): Kind {
  if (AUDIO.test(file.name) || file.type.startsWith('audio/')) return 'audio'
  if (VIDEO.test(file.name) || file.type.startsWith('video/')) return 'video'
  if (BOOK.test(file.name)) return 'book'
  if (TEXT.test(file.name) || file.type === 'text/plain') return 'text'
  return 'other'
}

const KIND_ICON: Record<Kind, LucideIcon> = { audio: FileAudio, video: Film, book: BookOpen, text: FileText, other: FileText }

interface Action {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  tint: string
}

function actionsFor(kind: Kind, count: number): Action[] {
  const transcribe: Action = { id: 'transcribe', label: count > 1 ? `Transcribe all ${count}` : 'Transcribe', hint: 'Turn the speech into text', icon: Mic, tint: '#30d158' }
  if (count > 1) return kind === 'audio' || kind === 'video' ? [transcribe] : []
  switch (kind) {
    case 'audio':
      return [
        { id: 'clone', label: 'Clone this voice', hint: 'Make a voice from the recording', icon: Copy, tint: '#bf5af2' },
        transcribe,
        { id: 'clean', label: 'Clean it up', hint: 'Remove noise, tighten pauses, level it', icon: Sparkles, tint: '#40c8e0' },
        { id: 'convert', label: 'Change the voice', hint: 'Same words, another voice', icon: Replace, tint: '#ff9f0a' },
      ]
    case 'video':
      return [{ id: 'dub', label: 'Dub this video', hint: 'Translate and re-voice it', icon: Film, tint: '#ff375f' }, transcribe, { id: 'clean', label: 'Clean up its audio', hint: 'Get a cleaned audio track', icon: Sparkles, tint: '#40c8e0' }]
    case 'book':
      return [
        { id: 'audiobook', label: 'Make an audiobook', hint: 'Chapters, narration, M4B', icon: BookOpen, tint: '#ff9f0a' },
        { id: 'story', label: 'Make a story', hint: 'A cast of voices for the characters', icon: Sparkles, tint: '#bf5af2' },
      ]
    case 'text':
      return [
        { id: 'studio', label: 'Open in Studio', hint: 'Read it with any voice', icon: PenLine, tint: '#0a84ff' },
        { id: 'audiobook', label: 'Make an audiobook', hint: 'Chapters, narration, M4B', icon: BookOpen, tint: '#ff9f0a' },
        { id: 'story', label: 'Make a story', hint: 'A cast of voices for the characters', icon: Sparkles, tint: '#bf5af2' },
      ]
    default:
      return []
  }
}

/** Files waiting for a decision — from a drop, or opened from Finder. `auto` runs an action directly. */
export const useDropSheet = create<{ files: File[] | null; auto: string | null; open: (files: File[], auto?: string | null) => void; close: () => void }>((set) => ({
  files: null,
  auto: null,
  open: (files, auto = null) => set({ files, auto }),
  close: () => set({ files: null, auto: null }),
}))

/** Tell the user when a background transcription is ready, with a shortcut to it. */
async function whenTranscribed(jobId: string, name: string, open: (id: string) => void) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500))
    const job = await voxd.job(jobId).catch(() => null)
    if (!job || job.status === 'queued' || job.status === 'running') continue
    if (job.status === 'succeeded') {
      const id = (job.result as { transcript_id: string }).transcript_id
      toast.success(`${name} is transcribed`, { action: { label: 'Open', onClick: () => open(id) } })
    }
    return
  }
}

/**
 * Drop files anywhere in the window. Pages with their own drop zones keep handling drops there
 * (they call preventDefault); everywhere else, a sheet asks what to do with the file.
 */
export function DropAnywhere() {
  const navigate = useNavigate()
  const [dragging, setDragging] = useState(false)
  const { files, auto, open: openSheet, close } = useDropSheet()
  const setFiles = (f: File[] | null) => (f ? openSheet(f) : close())
  const [busy, setBusy] = useState<string | null>(null)
  const [dubInto, setDubInto] = useState('en')
  const depth = useRef(0)
  const languages = useDubLanguages().data ?? []

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDragging(false)
    }
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault() // allow dropping anywhere
    const drop = (e: DragEvent) => {
      depth.current = 0
      setDragging(false)
      if (e.defaultPrevented || !hasFiles(e)) return // a page's own drop zone took it
      e.preventDefault()
      const dropped = [...(e.dataTransfer?.files ?? [])]
      if (dropped.length) setFiles(dropped)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  useEffect(() => {
    if (!files) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFiles(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [files])

  const run = async (action: string) => {
    if (!files) return
    const file = files[0]
    setBusy(action)
    try {
      const openTranscript = (id: string) => (useFocus.getState().open('transcript', id), void navigate({ to: '/transcribe' }))
      switch (action) {
        case 'transcribe':
          for (const f of files) {
            const job = await voxd.transcribe(f)
            void whenTranscribed(job.id, f.name, openTranscript)
          }
          toast(files.length > 1 ? `Transcribing ${files.length} files…` : `Transcribing ${file.name}…`, { description: 'Follow along in Activity.' })
          break
        case 'clone':
        case 'clean':
        case 'convert':
          useInbox.getState().put(action, file)
          void navigate({ to: action === 'clone' ? '/clone' : '/tools' })
          break
        case 'dub': {
          const dub = await voxd.createDub(file, dubInto)
          useFocus.getState().open('dub', dub.id)
          void navigate({ to: '/dub' })
          break
        }
        case 'audiobook':
        case 'story': {
          const book = await voxd.importBook({ file, kind: action })
          useFocus.getState().open('book', book.id)
          void navigate({ to: action === 'story' ? '/stories' : '/audiobook' })
          break
        }
        case 'studio':
          useStudio.getState().setText((await file.text()).slice(0, 200_000))
          void navigate({ to: '/studio' })
          break
      }
      setFiles(null)
    } catch (e) {
      toast.error('That didn’t work', { description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  // Finder Quick Actions name the action up front.
  useEffect(() => {
    if (files && auto) {
      const a = auto
      useDropSheet.setState({ auto: null })
      void run(a)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, auto])

  const kinds = files ? [...new Set(files.map(kindOf))] : []
  const kind: Kind = kinds.length === 1 ? kinds[0] : kinds.every((k) => k === 'audio' || k === 'video') ? 'audio' : 'other'
  const actions = files ? actionsFor(kind, files.length) : []
  const Icon = KIND_ICON[kind]

  return (
    <>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-end justify-center p-3 animate-[fade-in_120ms_ease-out]">
          <div className="absolute inset-2 rounded-[18px] border-2 border-dashed border-accent/70 bg-accent/5" />
          <div className="glass-pop relative mb-8 flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium">
            <Upload size={14} className="text-accent" /> Drop anywhere — then choose what VoxStudio does with it
          </div>
        </div>
      )}
      {files && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/25 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setFiles(null)}>
          <div role="dialog" aria-label="What should VoxStudio do?" className="glass-pop w-full max-w-lg space-y-4 rounded-[var(--radius-xl)] p-5 animate-[pop-in_240ms_var(--ease-spring)_both]">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-fill-control">
                <Icon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{files.length > 1 ? `${files.length} files` : files[0].name}</div>
                <div className="text-[12px] text-text-3">{files.length > 1 ? formatBytes(files.reduce((n, f) => n + f.size, 0)) : `${formatBytes(files[0].size)} · what should VoxStudio do with it?`}</div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setFiles(null)}>
                <X size={14} />
              </Button>
            </div>
            {actions.length ? (
              <div className="grid grid-cols-2 gap-2">
                {actions.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!!busy}
                    onClick={() => void run(a.id)}
                    className="flex items-start gap-3 rounded-[var(--radius-md)] bg-fill-control p-3 text-left transition-colors hover:bg-fill-hover disabled:opacity-60"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-[9px] text-white" style={{ background: `linear-gradient(145deg, ${a.tint}, color-mix(in srgb, ${a.tint} 60%, black))` }}>
                      {busy === a.id ? <Loader2 size={15} className="animate-spin" /> : <a.icon size={15} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{a.label}</span>
                      <span className="block text-[11px] text-text-3">{a.hint}</span>
                      {a.id === 'dub' && (
                        <select
                          value={dubInto}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setDubInto(e.target.value)}
                          aria-label="Dub into"
                          className="mt-1.5 h-6 rounded-[6px] border-[0.5px] border-hairline bg-[var(--glass-2)] px-1.5 text-[11px] outline-none"
                        >
                          {(languages.length ? languages : [{ code: 'en', name: 'English' }]).map((l) => (
                            <option key={l.code} value={l.code}>
                              into {l.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={cn('rounded-[var(--radius-md)] bg-fill-control p-3 text-[12px] text-text-2')}>
                VoxStudio can’t use this {files.length > 1 ? 'mix of files' : 'file type'}. Drop audio or video (to clone, transcribe, dub or clean up), or a book or text file (EPUB, DOCX, TXT, Markdown).
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
