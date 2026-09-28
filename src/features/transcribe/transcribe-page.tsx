import { useEffect, useMemo, useRef, useState } from 'react'
import { FileAudio, Loader2, Mic, Pause, Play, Search, Square, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, SegmentedControl } from '@/components/glass'
import { VoiceOrb } from '@/components/voice-orb'
import { playbackPosition, usePlayer } from '@/lib/audio/player'
import { startLiveTranscription } from '@/lib/audio/mic-stream'
import { formatBytes } from '@/lib/format'
import { isTauri } from '@/lib/platform'
import { timeAgo } from '@/lib/time'
import { voxd } from '@/lib/voxd/client'
import { useJob, useModels, usePatchTranscript, useTranscript, useTranscripts } from '@/lib/voxd/queries'
import type { Segment, Transcript } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { AddToProject } from '@/components/add-to-project'
import { useFocus } from '@/lib/store/focus'
import { DownloadBar, ModelActions, ModelArt } from '@/features/models/model-parts'

const LANGUAGES: [string, string][] = [
  ['', 'Detect automatically'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['ko', 'Korean'],
  ['ar', 'Arabic'],
  ['ru', 'Russian'],
  ['nl', 'Dutch'],
]
const FORMATS = ['txt', 'srt', 'vtt', 'json'] as const

const clock = (s: number) => {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-7 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] outline-none">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

// --------------------------------------------------------------------------- file

function FilePanel({ language, model, onDone }: { language: string; model: string; onDone: (id: string) => void }) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<File | null>(null)
  const job = useJob(jobId).data
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!job || job.status === 'queued' || job.status === 'running') return
    setJobId(null)
    setPending(null)
    if (job.status === 'succeeded') onDone((job.result as { transcript_id: string }).transcript_id)
    else if (job.status === 'failed') toast.error('Transcription failed', { description: job.error ?? undefined })
  }, [job, onDone])

  const start = async (file: File) => {
    setPending(file)
    try {
      const j = await voxd.transcribe(file, { language: language || undefined, model: model || undefined })
      setJobId(j.id)
    } catch (e) {
      setPending(null)
      toast.error('Couldn’t start transcription', { description: (e as Error).message })
    }
  }

  if (pending) {
    return (
      <div className="flex items-center gap-4 rounded-[var(--radius-lg)] border-[0.5px] border-hairline bg-[var(--glass-2)] p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">
          <FileAudio size={20} />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="truncate text-[13px] font-medium">
            {pending.name} <span className="text-text-3">· {formatBytes(pending.size)}</span>
          </div>
          <DownloadBar progress={job?.progress ?? 0} message={job ? job.message ?? 'Working…' : 'Uploading…'} />
        </div>
        {jobId && (
          <Button variant="ghost" size="sm" onClick={() => void voxd.cancelJob(jobId)}>
            Cancel
          </Button>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) void start(f)
      }}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-6 py-10 text-center transition-colors',
        dragging ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--hairline-strong)] hover:bg-fill-hover',
      )}
    >
      <Upload size={26} strokeWidth={1.5} className="text-text-3" />
      <span className="text-[14px] font-medium">Drop an audio or video file</span>
      <span className="text-[12px] text-text-3">or click to choose · MP3, M4A, WAV, MP4, MOV… up to 2 GB</span>
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void start(f)
          e.target.value = ''
        }}
      />
    </button>
  )
}

// --------------------------------------------------------------------------- live

function LivePanel({ language, onDone }: { language: string; onDone: (id: string) => void }) {
  const [state, setState] = useState<'idle' | 'starting' | 'listening' | 'finishing'>('idle')
  const [finals, setFinals] = useState<string[]>([])
  const [partial, setPartial] = useState('')
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const session = useRef<{ stop: () => void } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [finals, partial])
  useEffect(
    () => () => {
      session.current?.stop()
    },
    [],
  )

  const start = async () => {
    setState('starting')
    setFinals([])
    setPartial('')
    try {
      const s = await startLiveTranscription(voxd.liveUrl(language ? { language } : {}), {
        onPartial: setPartial,
        onFinal: (seg) => {
          setFinals((f) => [...f, seg.text])
          setPartial('')
        },
        onDone: ({ transcript_id }) => {
          setState('idle')
          setAnalyser(null)
          session.current = null
          if (transcript_id) onDone(transcript_id)
          else toast('Nothing was heard')
        },
        onError: (message) => {
          setState('idle')
          setAnalyser(null)
          session.current = null
          toast.error(message)
        },
      })
      session.current = s
      setAnalyser(s.analyser)
      setState('listening')
    } catch (e) {
      setState('idle')
      toast.error((e as Error).message)
    }
  }

  const stop = () => {
    setState('finishing')
    session.current?.stop()
  }

  const listening = state === 'listening'
  return (
    <div className="flex items-stretch gap-5 rounded-[var(--radius-lg)] border-[0.5px] border-hairline bg-[var(--glass-2)] p-5">
      <div className="flex w-40 shrink-0 flex-col items-center justify-center gap-3">
        <VoiceOrb mode={listening ? 'speaking' : state === 'idle' ? 'idle' : 'busy'} analyser={analyser} size={120} />
        {listening || state === 'finishing' ? (
          <Button variant="primary" className="bg-[#ff453a]" onClick={stop} disabled={state === 'finishing'}>
            {state === 'finishing' ? <Loader2 size={13} className="animate-spin" /> : <Square size={11} fill="currentColor" />} Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void start()} disabled={state === 'starting'}>
            <Mic size={13} /> {state === 'starting' ? 'Starting…' : 'Start listening'}
          </Button>
        )}
      </div>
      <div ref={scroller} className="max-h-48 min-h-32 flex-1 overflow-y-auto rounded-[var(--radius-md)] bg-[var(--glass-3)] p-4 text-[15px] leading-relaxed" aria-live="polite" aria-label="Live transcript">
        {finals.length || partial ? (
          <>
            {finals.join(' ')} <span className="text-text-3">{partial}</span>
          </>
        ) : (
          <span className="text-text-3">{listening ? 'Listening… start speaking.' : 'Press Start listening and speak. Text appears as you talk, and the transcript is saved when you stop.'}</span>
        )}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- viewer

async function exportAs(t: Transcript, format: (typeof FORMATS)[number]) {
  if (!isTauri) {
    const a = document.createElement('a')
    a.href = voxd.transcriptExportUrl(t.id, format)
    a.click()
    return
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: `${t.title}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
  if (!path) return
  try {
    await voxd.saveTranscript(t.id, format, path)
    toast.success('Exported', { description: path.split(/[\\/]/).pop() })
  } catch (e) {
    toast.error('Export failed', { description: (e as Error).message })
  }
}

function Viewer({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const t = useTranscript(id).data
  const patch = usePatchTranscript()
  const { current, play, stop, seek } = usePlayer()
  const key = `tr-${id}`
  const playing = current === key
  const [time, setTime] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setTitle(t?.title ?? '')
  }, [t?.title])
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      setTime(playbackPosition().time)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  if (!t) return <GlassPanel className="h-64 animate-pulse" />

  const playFrom = async (seconds: number) => {
    if (!t.has_audio) return
    if (!playing) await play(key, voxd.transcriptAudioUrl(t.id))
    seek(seconds)
  }
  const saveSegment = (i: number, text: string) => {
    setEditing(null)
    if (text.trim() === t.segments[i].text) return
    const segments: Segment[] = t.segments.map((s, j) => (j === i ? { ...s, text: text.trim() } : s))
    patch.mutate({ id: t.id, segments })
  }

  return (
    <GlassPanel className="flex min-h-0 flex-col overflow-hidden">
      <div className="space-y-3 border-b-[0.5px] border-hairline p-5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== t.title && patch.mutate({ id: t.id, title: title.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Title"
          className="w-full rounded-[6px] bg-transparent font-[var(--font-display)] text-[20px] font-semibold tracking-[-0.01em] outline-none hover:bg-fill-hover focus:bg-fill-control"
        />
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-3">
          <span>{clock(t.duration_s)}</span>·<span className="uppercase">{t.language}</span>·<span>{t.model.replace('whisper-', 'Whisper ')}</span>·<span>{t.source === 'live' ? 'Live' : 'File'}</span>·
          <span>{timeAgo(t.created_at)}</span>
          <div className="flex-1" />
          {t.has_audio && (
            <Button size="sm" onClick={() => (playing ? stop() : void play(key, voxd.transcriptAudioUrl(t.id)))}>
              {playing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />} {playing ? 'Pause' : 'Play'}
            </Button>
          )}
          <AddToProject kind="transcript" id={t.id} />
          {FORMATS.map((f) => (
            <Button key={f} size="sm" variant="ghost" onClick={() => void exportAs(t, f)}>
              {f.toUpperCase()}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Delete transcript"
            onBlur={() => setConfirmDelete(false)}
            onClick={() =>
              confirmDelete ? void voxd.deleteTranscript(t.id).then(() => (toast('Transcript deleted'), onDeleted())) : setConfirmDelete(true)
            }
            className={cn(confirmDelete && 'bg-[#ff453a]/12 text-[#ff453a]')}
          >
            <Trash2 size={12} /> {confirmDelete && 'Confirm'}
          </Button>
        </div>
      </div>
      <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3">
        {t.segments.map((s, i) => {
          const active = playing && time >= s.start && time < s.end
          return (
            <li key={i} className={cn('group flex gap-3 rounded-[10px] px-2 py-1.5 transition-colors', active ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]' : 'hover:bg-fill-hover')}>
              <button
                type="button"
                onClick={() => void playFrom(s.start)}
                disabled={!t.has_audio}
                className={cn('mt-0.5 w-12 shrink-0 text-left text-[11px] tabular-nums', t.has_audio ? 'text-[var(--accent)] hover:underline' : 'text-text-3')}
              >
                {clock(s.start)}
              </button>
              {editing === i ? (
                <textarea
                  autoFocus
                  defaultValue={s.text}
                  onBlur={(e) => saveSegment(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  rows={2}
                  className="flex-1 resize-none rounded-[6px] bg-[var(--glass-3)] px-2 py-1 text-[14px] leading-relaxed outline-none"
                />
              ) : (
                <p onDoubleClick={() => setEditing(i)} title="Double-click to correct" className="flex-1 cursor-text select-text text-[14px] leading-relaxed">
                  {s.text}
                </p>
              )}
            </li>
          )
        })}
      </ol>
    </GlassPanel>
  )
}

// --------------------------------------------------------------------------- page

export function TranscribePage() {
  const models = useModels().data
  const whisper = (models ?? []).filter((m) => m.engine === 'whisper')
  const installed = whisper.filter((m) => m.status === 'installed')
  const featured = whisper.find((m) => m.featured)
  const [mode, setMode] = useState<'file' | 'live'>('file')
  const [language, setLanguage] = useState('')
  const [model, setModel] = useState('')
  const [query, setQuery] = useState('')
  const list = useTranscripts(query.trim() || undefined).data ?? []
  const [selected, setSelected] = useState<string | null>(() => useFocus.getState().take('transcript'))

  useEffect(() => {
    if (!selected && list.length) setSelected(list[0].id)
  }, [list, selected])

  const modelOptions = useMemo<[string, string][]>(() => [['', 'Best installed'], ...installed.map((m) => [m.id, m.name] as [string, string])], [installed])

  if (models && !installed.length) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
        <header>
          <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Transcribe</h2>
          <p className="text-[14px] text-text-2">Turn recordings and your voice into text, privately, on this computer.</p>
        </header>
        <GlassPanel className="space-y-3 p-5">
          <div className="text-[14px] font-semibold">Pick a Whisper model to get started</div>
          {whisper.map((m) => (
            <div key={m.id} className="flex items-center gap-4 rounded-[var(--radius-md)] bg-fill-control p-3">
              <ModelArt model={m} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">
                  {m.name} {m.id === featured?.id && <span className="ml-1 text-[11px] font-medium text-[var(--accent)]">Recommended</span>}
                </div>
                <div className="text-[12px] text-text-2">{m.tagline}</div>
              </div>
              <div className="w-64">
                <ModelActions model={m} />
              </div>
            </div>
          ))}
        </GlassPanel>
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-[280px_minmax(0,1fr)] gap-5 p-6">
      <aside className="flex min-h-0 flex-col gap-3">
        <label className="flex h-7 items-center gap-2 rounded-[8px] bg-fill-control px-2.5 text-text-3">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search transcripts" className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-3" />
        </label>
        <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
          {list.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelected(t.id)}
                className={cn('w-full rounded-[10px] p-2.5 text-left transition-colors', selected === t.id ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'hover:bg-fill-hover')}
              >
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {t.source === 'live' ? <Mic size={12} className="shrink-0 text-text-3" /> : <FileAudio size={12} className="shrink-0 text-text-3" />}
                  <span className="truncate">{t.title}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-text-3">{t.preview || '—'}</div>
                <div className="mt-1 text-[10px] text-text-3">
                  {timeAgo(t.created_at)} · {clock(t.duration_s)}
                </div>
              </button>
            </li>
          ))}
          {!list.length && <li className="px-2 py-6 text-center text-[12px] text-text-3">{query ? 'No transcripts match.' : 'Your transcripts will appear here.'}</li>}
        </ul>
      </aside>

      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'file', label: 'Transcribe a file' },
              { value: 'live', label: 'Live' },
            ]}
          />
          <div className="flex-1" />
          <Select label="Language" value={language} onChange={setLanguage} options={LANGUAGES} />
          {mode === 'file' && installed.length > 1 && <Select label="Model" value={model} onChange={setModel} options={modelOptions} />}
        </div>
        {mode === 'file' ? <FilePanel language={language} model={model} onDone={setSelected} /> : <LivePanel language={language} onDone={setSelected} />}
        {selected ? <Viewer key={selected} id={selected} onDeleted={() => setSelected(null)} /> : null}
      </div>
    </div>
  )
}
