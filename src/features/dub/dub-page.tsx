import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, AudioLines, Download, Film, Languages, Loader2, Play, Plus, Trash2, Upload, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, SegmentedControl } from '@/components/glass'
import { VoiceAvatar } from '@/components/voice-avatar'
import { usePlayer } from '@/lib/audio/player'
import { isTauri } from '@/lib/platform'
import { timeAgo } from '@/lib/time'
import { voxd } from '@/lib/voxd/client'
import { useDub, useDubLanguages, useDubs, useEngines, useJob, useModels, useVoices } from '@/lib/voxd/queries'
import type { Dub, DubLine } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { AddToProject } from '@/components/add-to-project'
import { useFocus } from '@/lib/store/focus'
import { DownloadBar, ModelActions, ModelArt } from '@/features/models/model-parts'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const SPEAKERS = ['S1', 'S2', 'S3', 'S4']
const STATUS: Record<string, { label: string; tone: string }> = {
  preparing: { label: 'Preparing', tone: 'bg-[#ffd60a]/20 text-[#b38f00] dark:text-[#ffd60a]' },
  ready: { label: 'Ready to render', tone: 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]' },
  rendering: { label: 'Rendering', tone: 'bg-[#ffd60a]/20 text-[#b38f00] dark:text-[#ffd60a]' },
  done: { label: 'Done', tone: 'bg-[#30d158]/15 text-[#30d158]' },
  failed: { label: 'Failed', tone: 'bg-[#ff453a]/15 text-[#ff453a]' },
}

function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.ready
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', s.tone)}>{s.label}</span>
}

// ------------------------------------------------------------------ new dub

function NewDub({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel?: () => void }) {
  const languages = useDubLanguages().data ?? []
  const [file, setFile] = useState<File | null>(null)
  const [target, setTarget] = useState('en')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const chosen = languages.find((l) => l.code === target)

  const start = async () => {
    if (!file) return
    setBusy(true)
    try {
      const dub = await voxd.createDub(file, target)
      onCreated(dub.id)
    } catch (e) {
      toast.error('Couldn’t start the dub', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <GlassPanel className="mx-auto w-full max-w-xl space-y-5 p-6 animate-[pop-in_260ms_var(--ease-spring)]">
      <div className="flex items-center justify-between">
        <h3 className="font-[var(--font-display)] text-[20px] font-semibold tracking-[-0.01em]">New dub</h3>
        {onCancel && (
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onCancel}>
            <X size={15} />
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) setFile(f)
        }}
        className={cn(
          'flex w-full flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-6 py-8 text-center transition-colors',
          dragging ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--hairline-strong)] hover:bg-fill-hover',
        )}
      >
        {file ? <Film size={24} strokeWidth={1.5} className="text-[var(--accent)]" /> : <Upload size={24} strokeWidth={1.5} className="text-text-3" />}
        <span className="text-[14px] font-medium">{file ? file.name : 'Drop a video or audio file'}</span>
        <span className="text-[12px] text-text-3">{file ? `${(file.size / 1e6).toFixed(1)} MB · click to change` : 'MP4, MOV, MKV, WebM, MP3, M4A… up to 2 GB'}</span>
        <input ref={input} type="file" accept="video/*,audio/*" hidden onChange={(e) => (e.target.files?.[0] && setFile(e.target.files[0]), (e.target.value = ''))} />
      </button>
      <label className="flex items-center justify-between gap-4">
        <span className="text-[13px] font-medium">Dub into</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-56 rounded-[8px] border-[0.5px] border-hairline bg-fill-control px-2 text-[13px] outline-none">
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
              {l.has_voice ? '' : ' (no voice installed)'}
            </option>
          ))}
        </select>
      </label>
      {chosen && !chosen.has_voice && (
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[#ff9f0a]/12 p-3 text-[12px] text-text-1">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[#ff9f0a]" />
          No voice speaks {chosen.name} yet. You can prepare the dub now; download Kokoro in Models (or add a system voice in macOS Settings) before rendering.
        </p>
      )}
      <p className="text-[12px] text-text-3">VoxStudio transcribes the speech, translates it, and suggests a voice. You can review and edit every line before rendering.</p>
      <Button variant="primary" className="w-full justify-center" disabled={!file || busy} onClick={() => void start()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Start dubbing
      </Button>
    </GlassPanel>
  )
}

// ------------------------------------------------------------------ cast

function VoiceSelect({ lang, value, onChange }: { lang: string; value: { engine: string; voice: string } | null; onChange: (v: { engine: string; voice: string }) => void }) {
  const engines = (useEngines().data ?? []).filter((e) => e.available && e.capabilities.includes('tts'))
  const [engine, setEngine] = useState(value?.engine ?? engines[0]?.id ?? 'system')
  useEffect(() => {
    if (value?.engine) setEngine(value.engine)
  }, [value?.engine])
  const all = useVoices(engine).data ?? []
  // Cloned voices speak English only (Chatterbox); other engines: voices for the language.
  const voices = all.filter((v) => (v.id.startsWith('cv_') || v.id === 'default' ? lang === 'en' : v.language.split('-')[0] === lang))
  return (
    <div className="flex gap-1.5">
      <select
        aria-label="Engine"
        value={engine}
        onChange={(e) => setEngine(e.target.value)}
        className="h-7 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-1.5 text-[12px] outline-none"
      >
        {engines.map((e) => (
          <option key={e.id} value={e.id}>
            {e.id === 'system' ? 'System' : e.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Voice"
        value={value?.engine === engine ? value.voice : ''}
        onChange={(e) => onChange({ engine, voice: e.target.value })}
        className="h-7 min-w-0 flex-1 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-1.5 text-[12px] outline-none"
      >
        <option value="" disabled>
          {voices.length ? 'Choose a voice' : 'No voices for this language'}
        </option>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.gender ? (v.gender === 'female' ? ' ♀' : ' ♂') : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

// ------------------------------------------------------------------ lines

function FitBadge({ line }: { line: DubLine }) {
  const fit = line.fit as { speed: number; overflow_s: number } | null | undefined
  if (!fit) return null
  if (fit.overflow_s > 0.3) return <span className="rounded-full bg-[#ff453a]/15 px-1.5 text-[10px] font-medium text-[#ff453a]" title="Runs past the next line; shorten the translation">+{fit.overflow_s.toFixed(1)}s long</span>
  if (fit.speed > 1.12) return <span className="rounded-full bg-[#ff9f0a]/15 px-1.5 text-[10px] font-medium text-[#ff9f0a]" title="Sped up to fit its slot">{fit.speed.toFixed(2)}× faster</span>
  return <span className="rounded-full bg-[#30d158]/12 px-1.5 text-[10px] font-medium text-[#30d158]">fits</span>
}

function LineRow({ dub, line, index, onSeek, active }: { dub: Dub; line: DubLine; index: number; onSeek: (t: number) => void; active: boolean }) {
  const [text, setText] = useState(line.translation)
  const [previewing, setPreviewing] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  // Grow the box to fit its text (row counts guess wrong when the column is narrow).
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])
  const play = usePlayer((s) => s.play)
  useEffect(() => setText(line.translation), [line.translation])
  const locked = !!dub.job_id

  const save = (patch: { translation?: string; speaker?: string }) =>
    voxd.patchDub(dub.id, { segments: [{ id: line.id, ...patch }] }).catch((e: Error) => toast.error(e.message))

  const preview = async () => {
    setPreviewing(true)
    try {
      if (text !== line.translation) await save({ translation: text })
      const p = await voxd.previewDubLine(dub.id, line.id)
      await play(`dubline-${line.id}`, voxd.mediaUrl(p.audio_url))
    } catch (e) {
      toast.error('Preview failed', { description: (e as Error).message })
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <li className={cn('group grid grid-cols-[52px_40px_1fr_auto] items-start gap-2 rounded-[10px] px-2 py-2 transition-colors', active ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]' : 'hover:bg-fill-hover')}>
      <button type="button" onClick={() => onSeek(line.start)} className="pt-1 text-left text-[11px] tabular-nums text-[var(--accent)] hover:underline">
        {clock(line.start)}
      </button>
      <select
        aria-label={`Speaker for line ${index + 1}`}
        value={line.speaker}
        disabled={locked}
        onChange={(e) => void save({ speaker: e.target.value })}
        className="mt-0.5 h-6 rounded-[6px] bg-fill-control px-1 text-[11px] font-semibold outline-none"
      >
        {SPEAKERS.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <div className="min-w-0 space-y-1">
        <p className="text-[12px] leading-snug text-text-3">{line.text}</p>
        <textarea
          ref={box}
          value={text}
          disabled={locked}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== line.translation && void save({ translation: text })}
          rows={1}
          aria-label={`Translation for line ${index + 1}`}
          className="w-full resize-none rounded-[6px] bg-transparent px-1 py-0.5 text-[14px] leading-snug text-text-1 outline-none hover:bg-fill-hover focus:bg-[var(--glass-3)]"
        />
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        <FitBadge line={line} />
        <Button variant="ghost" size="icon" aria-label="Hear this line" onClick={() => void preview()} disabled={previewing || locked}>
          {previewing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
        </Button>
      </div>
    </li>
  )
}

// ------------------------------------------------------------------ editor

async function exportDub(dub: Dub, what: 'video' | 'audio' | 'srt' | 'vtt') {
  const ext = { video: 'mp4', audio: 'wav', srt: 'srt', vtt: 'vtt' }[what]
  if (!isTauri) {
    const a = document.createElement('a')
    a.href = what === 'srt' || what === 'vtt' ? voxd.dubSubtitlesUrl(dub.id, what) : voxd.mediaUrl(what === 'video' ? dub.video_url! : dub.audio_url!)
    a.download = `${dub.title}.${dub.target_lang}.${ext}`
    a.click()
    return
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: `${dub.title}.${dub.target_lang}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
  if (!path) return
  try {
    await voxd.saveDub(dub.id, what, path)
    toast.success('Exported', { description: path.split(/[\\/]/).pop() })
  } catch (e) {
    toast.error('Export failed', { description: (e as Error).message })
  }
}

function Editor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const dub = useDub(id).data
  const languages = useDubLanguages().data ?? []
  const job = useJob(dub?.job_id ?? null).data
  const [view, setView] = useState<'original' | 'dubbed'>('dubbed')
  const [time, setTime] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  const speakers = useMemo(() => [...new Set(dub?.segments.map((s) => s.speaker) ?? [])].sort(), [dub?.segments])
  if (!dub) return <GlassPanel className="h-96 animate-pulse" />

  const hasDub = !!(dub.video_url || dub.audio_url)
  const showing = hasDub && view === 'dubbed' ? (dub.video_url ?? dub.audio_url)! : dub.source_url
  const src = voxd.mediaUrl(showing)
  const busy = !!dub.job_id
  const lang = languages.find((l) => l.code === dub.target_lang)

  const seek = (t: number) => {
    if (!video.current) return
    video.current.currentTime = t
    void video.current.play()
  }

  const render = () =>
    voxd.renderDub(dub.id).catch((e: Error) => toast.error('Couldn’t render', { description: e.message }))

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 truncate font-[var(--font-display)] text-[22px] font-bold tracking-[-0.02em]">{dub.title}</h2>
        <StatusChip status={dub.status} />
        {dub.stale && !busy && <span className="rounded-full bg-[#ff9f0a]/15 px-2 py-0.5 text-[10px] font-semibold text-[#ff9f0a]">Edited since render</span>}
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1.5 text-[12px] text-text-2">
          <Languages size={13} /> {dub.source_lang?.toUpperCase() || '…'} →
        </span>
        <select
          aria-label="Target language"
          value={dub.target_lang}
          disabled={busy || !dub.segments.length}
          onChange={(e) => void voxd.retranslateDub(dub.id, e.target.value).catch((err: Error) => toast.error(err.message))}
          className="h-7 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] outline-none"
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <AddToProject kind="dub" id={dub.id} />
        <Button variant="primary" disabled={busy || !dub.segments.length} onClick={() => void render()}>
          <Wand2 size={13} /> {hasDub ? (dub.stale ? 'Render again' : 'Re-render') : 'Render dub'}
        </Button>
      </div>

      {busy && (
        <GlassPanel className="flex items-center gap-4 p-4">
          <Loader2 size={18} className="shrink-0 animate-spin text-[var(--accent)]" />
          <div className="flex-1">
            <DownloadBar progress={job?.progress ?? 0} message={job?.message ?? (dub.status === 'preparing' ? 'Preparing…' : 'Working…')} />
          </div>
          {dub.job_id && (
            <Button variant="ghost" size="sm" onClick={() => void voxd.cancelJob(dub.job_id!)}>
              Cancel
            </Button>
          )}
        </GlassPanel>
      )}
      {dub.status === 'failed' && dub.error && (
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[#ff453a]/10 p-3 text-[12px] text-[#ff453a]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {dub.error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <GlassPanel className="overflow-hidden p-0">
            {dub.has_video ? (
              <video
                key={src}
                ref={video}
                src={src}
                controls
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                className="aspect-video w-full bg-black"
              />
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-[var(--glass-2)]">
                <AudioLines size={32} className="text-text-3" />
                <audio key={src} ref={video as unknown as React.RefObject<HTMLAudioElement>} src={src} controls onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} />
              </div>
            )}
            <div className="flex items-center gap-2 p-3">
              <SegmentedControl
                aria-label="Listen to"
                value={hasDub ? view : 'original'}
                onChange={setView}
                options={[
                  { value: 'original', label: 'Original' },
                  { value: 'dubbed', label: 'Dubbed' },
                ]}
              />
              <div className="flex-1" />
              {hasDub && (
                <>
                  {dub.video_url && (
                    <Button size="sm" onClick={() => void exportDub(dub, 'video')}>
                      <Download size={12} /> Video
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void exportDub(dub, 'audio')}>
                    Audio
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" disabled={!dub.segments.length} onClick={() => void exportDub(dub, 'srt')}>
                SRT
              </Button>
              <Button size="sm" variant="ghost" disabled={!dub.segments.length} onClick={() => void exportDub(dub, 'vtt')}>
                VTT
              </Button>
            </div>
          </GlassPanel>

          <GlassPanel className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Cast</h3>
              <SegmentedControl
                aria-label="Mix"
                value={dub.mix}
                onChange={(mix) => void voxd.patchDub(dub.id, { mix })}
                options={[
                  { value: 'duck', label: 'Keep original quietly' },
                  { value: 'replace', label: 'Replace' },
                ]}
              />
            </div>
            {lang && !lang.has_voice && <p className="text-[12px] text-[#ff9f0a]">No installed voice speaks {lang.name}. Download Kokoro from Models.</p>}
            {speakers.map((sp) => (
              <div key={sp} className="flex items-center gap-3">
                <VoiceAvatar id={sp} name={sp.replace('S', '')} size={26} />
                <span className="w-10 text-[12px] font-semibold">{sp}</span>
                <div className="min-w-0 flex-1">
                  <VoiceSelect
                    lang={dub.target_lang}
                    value={dub.cast[sp] ?? null}
                    onChange={(v) => void voxd.patchDub(dub.id, { cast: { [sp]: v } }).catch((e: Error) => toast.error(e.message))}
                  />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-text-3">Assign lines to speakers S1–S4 in the list; each speaker gets its own voice.</p>
          </GlassPanel>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onBlur={() => setConfirm(false)}
              onClick={() => (confirm ? void voxd.deleteDub(dub.id).then(() => (toast('Dub deleted'), onDeleted())) : setConfirm(true))}
              className={cn(confirm && 'bg-[#ff453a]/12 text-[#ff453a]')}
            >
              <Trash2 size={12} /> {confirm ? 'Confirm delete' : 'Delete dub'}
            </Button>
          </div>
        </div>

        <GlassPanel className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b-[0.5px] border-hairline px-4 py-3">
            <h3 className="text-[13px] font-semibold">Lines</h3>
            <span className="text-[11px] text-text-3">{dub.segments.length} lines · edit any translation, then Render</span>
          </div>
          <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            {dub.segments.map((line, i) => (
              <LineRow key={line.id} dub={dub} line={line} index={i} onSeek={seek} active={time >= line.start && time < line.end} />
            ))}
            {!dub.segments.length && <li className="px-3 py-10 text-center text-[12px] text-text-3">{dub.status === 'preparing' ? 'Transcribing and translating…' : 'No lines yet.'}</li>}
          </ol>
        </GlassPanel>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ page

export function DubPage() {
  const models = useModels().data
  const whisper = (models ?? []).filter((m) => m.engine === 'whisper')
  const ready = whisper.some((m) => m.status === 'installed')
  const dubs = useDubs().data ?? []
  const [selected, setSelected] = useState<string | null>(() => useFocus.getState().take('dub'))
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!selected && dubs.length && !creating) setSelected(dubs[0].id)
  }, [dubs, selected, creating])

  if (models && !ready) {
    const base = whisper.find((m) => m.featured) ?? whisper[0]
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-8 py-8">
        <header>
          <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Dub a video</h2>
          <p className="text-[14px] text-text-2">Translate and re-voice any video, on your computer.</p>
        </header>
        {base && (
          <GlassPanel className="flex items-center gap-4 p-5">
            <ModelArt model={base} size={48} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Dubbing starts by listening</div>
              <div className="text-[12px] text-text-2">Download {base.name} to transcribe videos. Translation packs download automatically when needed.</div>
            </div>
            <div className="w-64">
              <ModelActions model={base} />
            </div>
          </GlassPanel>
        )}
      </div>
    )
  }

  const showNew = creating || (!dubs.length && models)
  return (
    <div className="grid h-full grid-cols-[240px_minmax(0,1fr)] gap-5 p-6">
      <aside className="flex min-h-0 flex-col gap-3">
        <Button variant="primary" className="justify-center" onClick={() => (setCreating(true), setSelected(null))}>
          <Plus size={14} /> New dub
        </Button>
        <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
          {dubs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => (setSelected(d.id), setCreating(false))}
                className={cn('w-full rounded-[10px] p-2.5 text-left transition-colors', selected === d.id && !creating ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'hover:bg-fill-hover')}
              >
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {d.has_video ? <Film size={12} className="shrink-0 text-text-3" /> : <AudioLines size={12} className="shrink-0 text-text-3" />}
                  <span className="truncate">{d.title}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-text-3">
                  <StatusChip status={d.status} />
                  <span className="uppercase">
                    {d.source_lang || '…'} → {d.target_lang}
                  </span>
                  · {timeAgo(d.created_at)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-h-0 overflow-y-auto">
        {showNew ? (
          <div className="py-6">
            <NewDub
              onCreated={(id) => {
                setCreating(false)
                setSelected(id)
              }}
              onCancel={dubs.length ? () => setCreating(false) : undefined}
            />
          </div>
        ) : selected ? (
          <Editor key={selected} id={selected} onDeleted={() => setSelected(null)} />
        ) : null}
      </div>
    </div>
  )
}
