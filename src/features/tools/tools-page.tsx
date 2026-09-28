import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, AudioWaveform, BookA, FileAudio, Loader2, Pause, Play, Plus, Replace, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, SegmentedControl, Switch } from '@/components/glass'
import { Waveform } from '@/components/waveform'
import { usePlayer } from '@/lib/audio/player'
import { voiceLabel } from '@/lib/voice-label'
import { voxd } from '@/lib/voxd/client'
import { useCustomVoices, useEngines, useJob, usePronunciations, useTakes } from '@/lib/voxd/queries'
import type { Pronunciation, Take } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'

type Tool = 'clean' | 'convert' | 'pronounce'

const TOOLS: { id: Tool; label: string; icon: typeof Sparkles; blurb: string; tint: string }[] = [
  { id: 'clean', label: 'Clean up', icon: Sparkles, blurb: 'Remove hiss and hum, shorten long pauses and bring the level up to podcast loudness.', tint: '#30d158' },
  { id: 'convert', label: 'Change voice', icon: Replace, blurb: 'Keep the words, timing and delivery of a recording and speak it in another voice.', tint: '#bf5af2' },
  { id: 'pronounce', label: 'Pronunciation', icon: BookA, blurb: 'Teach every voice how to say names, acronyms and brand words.', tint: '#ff9f0a' },
]

// --------------------------------------------------------------------------- source

/** Either a file from disk or one of your takes. */
type Source = { kind: 'file'; file: File; url: string; duration: number } | { kind: 'take'; take: Take }

const sourceUrl = (s: Source) => (s.kind === 'file' ? s.url : voxd.mediaUrl(`/v1/takes/${s.take.id}/audio`))
const sourceName = (s: Source) => (s.kind === 'file' ? s.file.name : s.take.text.slice(0, 60) || 'Take')
const sourceId = (s: Source) => (s.kind === 'file' ? `file:${s.url}` : s.take.id)

function SourcePicker({ value, onChange, accept }: { value: Source | null; onChange: (s: Source | null) => void; accept: string }) {
  const takes = useTakes(20).data ?? []
  const custom = useCustomVoices().data ?? []
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const pick = (file: File | undefined) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const probe = new Audio(url)
    probe.onloadedmetadata = () => onChange({ kind: 'file', file, url, duration: Number.isFinite(probe.duration) ? probe.duration : 0 })
    probe.onerror = () => onChange({ kind: 'file', file, url, duration: 0 })
  }
  useEffect(() => () => void (value?.kind === 'file' && URL.revokeObjectURL(value.url)), [value])

  if (value) {
    const duration = value.kind === 'file' ? value.duration : value.take.duration_s
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-fill-control px-3 py-2.5">
        <FileAudio size={16} className="shrink-0 text-text-3" />
        <div className="w-44 min-w-0 shrink-0">
          <div className="truncate text-[13px] font-medium">{sourceName(value)}</div>
          <div className="text-[11px] text-text-3">{value.kind === 'file' ? 'From your Mac' : voiceLabel(value.take, custom)} · {duration.toFixed(1)} s</div>
        </div>
        <Waveform id={sourceId(value)} url={sourceUrl(value)} duration={duration} bars={64} className="h-8 min-w-0 flex-1" />
        <Button variant="ghost" size="icon" aria-label="Choose another" onClick={() => onChange(null)}>
          <X size={13} />
        </Button>
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files[0])
        }}
        className={cn(
          'flex min-h-32 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--hairline-strong)] text-center transition-colors',
          dragging ? 'border-accent bg-accent/8' : 'hover:bg-fill-hover',
        )}
      >
        <Upload size={20} strokeWidth={1.6} className="text-text-3" />
        <span className="text-[13px] font-medium">Drop audio or video here</span>
        <span className="text-[11px] text-text-3">or click to choose a file</span>
        <input ref={input} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files?.[0])} />
      </button>
      <div className="flex min-h-32 flex-col overflow-hidden rounded-[var(--radius-md)] bg-fill-control">
        <div className="px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-text-3">Or use a recent take</div>
        <ul className="max-h-40 flex-1 overflow-y-auto pb-1">
          {takes.length ? (
            takes.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onChange({ kind: 'take', take: t })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-fill-hover">
                  <span className="min-w-0 flex-1 truncate text-[12px]">{t.text || 'Untitled'}</span>
                  <span className="shrink-0 text-[11px] text-text-3">{t.duration_s.toFixed(1)} s</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-[12px] text-text-3">No takes yet.</li>
          )}
        </ul>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- job + result

function useToolJob(onDone: (result: Record<string, unknown>) => void) {
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId).data
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!job || job.status === 'queued' || job.status === 'running') return
    setJobId(null)
    if (job.status === 'succeeded') done.current(job.result as Record<string, unknown>)
    else if (job.status === 'failed') toast.error('That didn’t work', { description: job.error ?? undefined })
  }, [job])
  return { job: jobId ? job : undefined, busy: !!jobId, start: setJobId }
}

function Progress({ fraction, message }: { fraction: number; message: string }) {
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-fill-control">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(4, fraction * 100)}%` }} />
      </div>
      <div className="text-[11px] text-text-3">{message}</div>
    </div>
  )
}

function ResultTake({ takeId, before }: { takeId: string; before: Source }) {
  const take = useTakes(20).data?.find((t) => t.id === takeId)
  const navigate = useNavigate()
  const { current, play, stop } = usePlayer()
  if (!take) return null
  const afterUrl = voxd.mediaUrl(`/v1/takes/${take.id}/audio`)
  const row = (label: string, id: string, url: string, duration: number) => (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" aria-label={`Play ${label.toLowerCase()}`} onClick={() => (current === id ? stop() : void play(id, url))}>
        {current === id ? <Pause size={14} /> : <Play size={14} />}
      </Button>
      <span className="w-12 shrink-0 text-[11px] font-semibold tracking-wide text-text-3">{label}</span>
      <Waveform id={id} url={url} duration={duration} bars={80} className="h-8 min-w-0 flex-1" />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-text-3">{duration.toFixed(1)} s</span>
    </div>
  )
  return (
    <div className="space-y-2 rounded-[var(--radius-md)] bg-fill-control p-3">
      {row('Before', sourceId(before), sourceUrl(before), before.kind === 'file' ? before.duration : before.take.duration_s)}
      {row('After', take.id, afterUrl, take.duration_s)}
      <div className="flex justify-end pt-1">
        <Button size="sm" variant="ghost" onClick={() => void navigate({ to: '/history' })}>
          Saved to History <ArrowRight size={11} />
        </Button>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- clean

const LOUDNESS = [
  { value: '-16', label: 'Podcast' },
  { value: '-14', label: 'Streaming' },
  { value: '-23', label: 'Broadcast' },
] as const

function Meter({ label, before, after }: { label: string; before: number; after: number }) {
  const pct = (db: number) => `${Math.min(100, Math.max(0, ((db + 60) / 60) * 100))}%`
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-text-3">
        <span>{label}</span>
        <span className="tabular-nums">
          {before.toFixed(1)} → <span className="font-semibold text-text-1">{after.toFixed(1)} dB</span>
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-fill-control">
        <div className="absolute inset-y-0 left-0 rounded-full bg-text-3/40" style={{ width: pct(before) }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-[#30d158] transition-[width] duration-700 ease-[var(--ease-spring)]" style={{ width: pct(after) }} />
      </div>
    </div>
  )
}

function CleanTool() {
  const [source, setSource] = useState<Source | null>(null)
  const [denoise, setDenoise] = useState(true)
  const [trim, setTrim] = useState(true)
  const [normalize, setNormalize] = useState(true)
  const [loudness, setLoudness] = useState<(typeof LOUDNESS)[number]['value']>('-16')
  const [result, setResult] = useState<{ take_id: string; stats: Record<string, number>; before: Source } | null>(null)
  const media = useEngines().data?.find((e) => e.id === 'whisper')
  const { job, busy, start } = useToolJob((r) => source && setResult({ take_id: r.take_id as string, stats: r as Record<string, number>, before: source }))

  const run = async () => {
    if (!source) return
    setResult(null)
    try {
      const j = await voxd.cleanAudio(source.kind === 'file' ? source.file : source.take.id, { denoise, trim, normalize, loudness: Number(loudness) })
      start(j.id)
    } catch (e) {
      toast.error('Couldn’t start', { description: (e as Error).message })
    }
  }

  const options = (
    [
      ['Reduce noise', 'Hiss, hum, fans and low rumble', denoise, setDenoise],
      ['Tighten pauses', 'Silences over 0.6 s and dead air at both ends', trim, setTrim],
      ['Even out loudness', 'Match a standard level so clips sit together', normalize, setNormalize],
    ] as const
  ).map(([label, hint, on, set]) => (
    <label key={label} className="flex items-center gap-3 py-2">
      <div className="flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[11px] text-text-3">{hint}</div>
      </div>
      <Switch checked={on} onChange={set} label={label} />
    </label>
  ))

  return (
    <div className="space-y-5">
      <SourcePicker value={source} onChange={(s) => (setSource(s), setResult(null))} accept="audio/*,video/*" />
      <div className="grid gap-5 md:grid-cols-[1fr_16rem]">
        <div className="divide-y-[0.5px] divide-[var(--hairline)]">{options}</div>
        <div className={cn('space-y-2 transition-opacity', !normalize && 'pointer-events-none opacity-40')}>
          <div className="text-[11px] font-semibold tracking-wide text-text-3">Target level</div>
          <SegmentedControl aria-label="Target loudness" value={loudness} onChange={setLoudness} options={LOUDNESS.map((l) => ({ value: l.value, label: l.label }))} />
          <div className="text-[11px] text-text-3">{loudness} LUFS, peaks kept under −1.5 dB</div>
        </div>
      </div>
      {media && !media.available && <p className="text-[12px] text-[#ff9f0a]">Audio tools use the Whisper runtime to read media — download any Whisper model from Models first.</p>}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!source || busy || !(denoise || trim || normalize) || (media && !media.available)} onClick={() => void run()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Clean up
        </Button>
        {job && <div className="flex-1"><Progress fraction={job.progress} message={job.message ?? 'Working…'} /></div>}
      </div>
      {result && (
        <div className="space-y-3 animate-[pop-in_300ms_var(--ease-spring)_both]">
          <ResultTake takeId={result.take_id} before={result.before} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Meter label="Average level" before={result.stats.rms_in} after={result.stats.rms_out} />
            <Meter label="Peak" before={result.stats.peak_in} after={result.stats.peak_out} />
            <div className="space-y-1">
              <div className="text-[11px] text-text-3">Length</div>
              <div className="text-[13px] tabular-nums">
                {result.stats.duration_in.toFixed(1)} s → <span className="font-semibold">{result.stats.duration_out.toFixed(1)} s</span>
                {result.stats.duration_in - result.stats.duration_out > 0.1 && (
                  <span className="ml-1.5 text-[11px] text-[#30d158]">−{(result.stats.duration_in - result.stats.duration_out).toFixed(1)} s dead air</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------- convert

function ConvertTool() {
  const [source, setSource] = useState<Source | null>(null)
  const [voice, setVoice] = useState('default')
  const [result, setResult] = useState<{ take_id: string; before: Source } | null>(null)
  const custom = useCustomVoices().data ?? []
  const chatterbox = useEngines().data?.find((e) => e.id === 'chatterbox')
  const navigate = useNavigate()
  const { job, busy, start } = useToolJob((r) => source && setResult({ take_id: r.take_id as string, before: source }))

  const run = async () => {
    if (!source) return
    setResult(null)
    try {
      start((await voxd.convertVoice(source.kind === 'file' ? source.file : source.take.id, voice)).id)
    } catch (e) {
      toast.error('Couldn’t start', { description: (e as Error).message })
    }
  }

  if (chatterbox && !chatterbox.available)
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Replace size={26} strokeWidth={1.4} className="text-text-3" />
        <div className="max-w-sm text-[13px] text-text-2">Changing a voice uses the Chatterbox engine. {chatterbox.unavailable_reason}</div>
        <Button size="sm" onClick={() => void navigate({ to: '/models' })}>
          Open Models <ArrowRight size={11} />
        </Button>
      </div>
    )

  const voices = [{ id: 'default', name: 'Chatterbox Default', hint: 'Built in' }, ...custom.map((v) => ({ id: v.id, name: v.name, hint: 'Your voice' }))]
  return (
    <div className="space-y-5">
      <SourcePicker value={source} onChange={(s) => (setSource(s), setResult(null))} accept="audio/*,video/*" />
      <div className="space-y-2">
        <div className="text-[11px] font-semibold tracking-wide text-text-3">Speak it as</div>
        <div className="flex flex-wrap gap-2">
          {voices.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={voice === v.id}
              onClick={() => setVoice(v.id)}
              className={cn(
                'rounded-[10px] px-3 py-2 text-left transition-all',
                voice === v.id ? 'bg-accent text-white shadow-[0_4px_14px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]' : 'bg-fill-control hover:bg-fill-hover',
              )}
            >
              <div className="text-[13px] font-medium">{v.name}</div>
              <div className={cn('text-[11px]', voice === v.id ? 'text-white/75' : 'text-text-3')}>{v.hint}</div>
            </button>
          ))}
          <button type="button" onClick={() => void navigate({ to: '/clone' })} className="flex items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--hairline-strong)] px-3 py-2 text-[12px] text-text-2 hover:bg-fill-hover">
            <Plus size={12} /> Clone a voice
          </button>
        </div>
      </div>
      <p className="flex items-start gap-2 text-[11px] text-text-3">
        <ShieldCheck size={13} className="mt-px shrink-0" />
        Only convert recordings you have the right to use. Results carry an inaudible watermark that marks them as AI-generated.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!source || busy} onClick={() => void run()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <AudioWaveform size={13} />} Change voice
        </Button>
        {job && <div className="flex-1"><Progress fraction={job.progress} message={job.message ?? 'Working…'} /></div>}
      </div>
      {result && (
        <div className="animate-[pop-in_300ms_var(--ease-spring)_both]">
          <ResultTake takeId={result.take_id} before={result.before} />
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------- pronunciation

function RuleRow({ rule }: { rule: Pronunciation }) {
  const save = (field: 'term' | 'say', value: string) => {
    const v = value.trim()
    if (v && v !== rule[field]) voxd.patchPronunciation(rule.id, { [field]: v }).catch((e: Error) => toast.error(e.message))
  }
  const input = 'min-w-0 flex-1 rounded-[6px] bg-transparent px-2 py-1 text-[13px] outline-none hover:bg-fill-hover focus:bg-fill-control'
  return (
    <li className="group flex items-center gap-2 px-2 py-1.5">
      <input key={`t${rule.term}`} defaultValue={rule.term} aria-label="Written as" onBlur={(e) => save('term', e.target.value)} className={cn(input, 'font-medium')} />
      <ArrowRight size={12} className="shrink-0 text-text-3" />
      <input key={`s${rule.say}`} defaultValue={rule.say} aria-label="Said as" onBlur={(e) => save('say', e.target.value)} className={input} />
      <button
        type="button"
        title="Match capitalization exactly"
        aria-pressed={rule.case_sensitive}
        onClick={() => void voxd.patchPronunciation(rule.id, { case_sensitive: !rule.case_sensitive })}
        className={cn('shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] font-bold', rule.case_sensitive ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-fill-hover')}
      >
        Aa
      </button>
      <Button variant="ghost" size="icon" aria-label={`Remove ${rule.term}`} onClick={() => void voxd.deletePronunciation(rule.id)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
        <Trash2 size={12} />
      </Button>
    </li>
  )
}

function PronounceTool() {
  const rules = usePronunciations().data ?? []
  const [term, setTerm] = useState('')
  const [say, setSay] = useState('')
  const [sample, setSample] = useState('Our CEO will demo VoxStudio at the SQL meetup in Nguyen Hall.')
  const [preview, setPreview] = useState('')
  const termInput = useRef<HTMLInputElement>(null)

  const rulesKey = useMemo(() => rules.map((r) => `${r.term}=${r.say}:${r.case_sensitive}`).join('|'), [rules])
  useEffect(() => {
    const t = setTimeout(() => voxd.previewPronunciation(sample).then((r) => setPreview(r.text), () => setPreview('')), 200)
    return () => clearTimeout(t)
  }, [sample, rulesKey])

  const add = () => {
    const [t, w] = [term.trim(), say.trim()]
    if (!t || !w) return
    setTerm('')
    setSay('')
    termInput.current?.focus()
    voxd.addPronunciation({ term: t, say: w }).catch((e: Error) => {
      toast.error(e.message)
      setTerm(t)
      setSay(w)
    })
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
      <div className="space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
          className="flex items-center gap-2 rounded-[var(--radius-md)] bg-fill-control p-1.5"
        >
          <input ref={termInput} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Written as — e.g. Nguyen" aria-label="New word" className="min-w-0 flex-1 bg-transparent px-2 text-[13px] outline-none placeholder:text-text-3" />
          <ArrowRight size={12} className="shrink-0 text-text-3" />
          <input value={say} onChange={(e) => setSay(e.target.value)} placeholder="Say it like — e.g. Win" aria-label="Pronounce as" className="min-w-0 flex-1 bg-transparent px-2 text-[13px] outline-none placeholder:text-text-3" />
          <Button type="submit" size="sm" variant="primary" disabled={!term.trim() || !say.trim()}>
            <Plus size={12} /> Add
          </Button>
        </form>
        {rules.length ? (
          <ul className="divide-y-[0.5px] divide-[var(--hairline)]">
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} />
            ))}
          </ul>
        ) : (
          <p className="px-2 py-4 text-[12px] text-text-3">No words yet. Spell the replacement the way it sounds — “sequel” for SQL, “Win” for Nguyen.</p>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold tracking-wide text-text-3">Try it</div>
        <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={4} aria-label="Sample text" className="w-full resize-none rounded-[var(--radius-md)] bg-fill-control p-3 text-[13px] outline-none" />
        <div className="rounded-[var(--radius-md)] border-[0.5px] border-hairline p-3 text-[13px] leading-relaxed">
          <div className="mb-1 text-[10px] font-semibold tracking-wide text-text-3 uppercase">Voices will read</div>
          {preview || <span className="text-text-3">…</span>}
        </div>
        <p className="text-[11px] text-text-3">Applies to Studio, long renders, dubs, stories and audiobooks. Your scripts and history keep what you wrote.</p>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- page

export function ToolsPage() {
  const [tool, setTool] = useState<Tool>('clean')
  const active = TOOLS.find((t) => t.id === tool)!
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-8">
      <header>
        <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Tools</h2>
        <p className="text-[14px] text-text-2">Polish recordings and fine-tune how every voice speaks.</p>
      </header>
      <div role="tablist" aria-label="Tool" className="grid grid-cols-3 gap-3">
        {TOOLS.map((t) => {
          const Icon = t.icon
          const on = t.id === tool
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => setTool(t.id)}
              className={cn('glass flex items-center gap-3 rounded-[var(--radius-lg)] p-3 text-left transition-all duration-200 ease-[var(--ease-spring)]', on ? 'shadow-[0_0_0_1.5px_var(--tint)] -translate-y-px' : 'opacity-75 hover:opacity-100')}
              style={{ '--tint': t.tint } as React.CSSProperties}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] text-white" style={{ background: `linear-gradient(145deg, ${t.tint}, color-mix(in srgb, ${t.tint} 60%, black))` }}>
                <Icon size={17} />
              </span>
              <span className="text-[14px] font-semibold">{t.label}</span>
            </button>
          )
        })}
      </div>
      <GlassPanel className="space-y-5 p-6">
        <p className="text-[13px] text-text-2">{active.blurb}</p>
        {tool === 'clean' ? <CleanTool /> : tool === 'convert' ? <ConvertTool /> : <PronounceTool />}
      </GlassPanel>
    </div>
  )
}
