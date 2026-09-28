import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileAudio, FileText, FolderOpen, Layers, Loader2, Pause, Play, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, SegmentedControl, Switch } from '@/components/glass'
import { pickFiles, pickFolder } from '@/lib/pick'
import { timeAgo } from '@/lib/time'
import { voxd } from '@/lib/voxd/client'
import { useBatches, useEngines, useModels, useVoices, useWatchFolders } from '@/lib/voxd/queries'
import type { Batch, WatchFolder } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { voiceLabel } from '@/lib/voice-label'

type Tab = 'speak' | 'transcribe' | 'watch'
const MEDIA = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'mkv', 'webm', 'm4v']
const FORMATS = ['txt', 'srt', 'vtt', 'json'] as const
const basename = (p: string) => p.split(/[\\/]/).pop() ?? p

/** Split pasted text into items: blank-line separated blocks, or one per line when there are no blank lines. */
function splitItems(text: string): { name: string; text: string }[] {
  const blocks = text.includes('\n\n') ? text.split(/\n\s*\n/) : text.split('\n')
  return blocks
    .map((b) => b.trim())
    .filter(Boolean)
    .map((t, i) => ({ name: `${String(i + 1).padStart(2, '0')} ${t.split(/\s+/).slice(0, 5).join(' ')}`.slice(0, 60), text: t }))
}

function VoiceChoice({ engine, voice, onChange }: { engine: string; voice: string; onChange: (engine: string, voice: string) => void }) {
  const engines = (useEngines().data ?? []).filter((e) => e.available && e.capabilities.includes('tts'))
  const voices = useVoices(engine).data ?? []
  return (
    <div className="flex gap-1.5">
      <select aria-label="Engine" value={engine} onChange={(e) => onChange(e.target.value, '')} className="h-8 rounded-[8px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] outline-none">
        {engines.map((e) => (
          <option key={e.id} value={e.id}>
            {e.id === 'system' ? 'System' : e.name}
          </option>
        ))}
      </select>
      <select aria-label="Voice" value={voice} onChange={(e) => onChange(engine, e.target.value)} className="h-8 min-w-0 flex-1 rounded-[8px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] outline-none">
        <option value="" disabled>
          Choose a voice
        </option>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} · {v.language}
          </option>
        ))}
      </select>
    </div>
  )
}

function OutputFolder({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => void pickFolder('Save results to').then((p) => p && onChange(p))}>
        <FolderOpen size={12} /> {value ? 'Change folder' : 'Save files to a folder…'}
      </Button>
      {value ? (
        <span className="flex min-w-0 items-center gap-1 text-[12px] text-text-2">
          <span className="truncate" title={value}>
            {value}
          </span>
          <button type="button" aria-label="Don't save to a folder" onClick={() => onChange(null)} className="text-text-3 hover:text-text-1">
            <X size={12} />
          </button>
        </span>
      ) : (
        <span className="text-[12px] text-text-3">Optional: results are always kept in VoxStudio too.</span>
      )}
    </div>
  )
}

function SpeakMany() {
  const [text, setText] = useState('')
  const [engine, setEngine] = useState('kokoro')
  const [voice, setVoice] = useState('')
  const [out, setOut] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const items = useMemo(() => splitItems(text), [text])

  const addFiles = async (list: FileList) => {
    const parts = await Promise.all([...list].map(async (f) => `${(await f.text()).trim()}`))
    setText((t) => [t.trim(), ...parts].filter(Boolean).join('\n\n'))
  }

  const start = async () => {
    setBusy(true)
    try {
      await voxd.createBatch({ kind: 'speech', engine, voice, items, output_dir: out, speed: 1, formats: ['txt'] })
      toast.success(`Queued ${items.length} item${items.length === 1 ? '' : 's'}`)
      setText('')
    } catch (e) {
      toast.error('Couldn’t start', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <GlassPanel className="space-y-4 p-5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'One item per line — or separate longer passages with a blank line.\n\nEach item becomes its own audio file.'}
        className="min-h-44 w-full resize-y rounded-[var(--radius-md)] border-[0.5px] border-hairline bg-[var(--glass-3)] p-3 text-[14px] leading-relaxed outline-none"
        aria-label="Texts"
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-text-3">{items.length} item{items.length === 1 ? '' : 's'}</span>
        <Button size="sm" variant="ghost" onClick={() => files.current?.click()}>
          <FileText size={12} /> Add .txt files
        </Button>
        <input ref={files} type="file" accept=".txt,.md" multiple hidden onChange={(e) => (e.target.files && void addFiles(e.target.files), (e.target.value = ''))} />
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <VoiceChoice engine={engine} voice={voice} onChange={(e, v) => (setEngine(e), setVoice(v))} />
        <Button variant="primary" disabled={!items.length || !voice || busy} onClick={() => void start()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />} Speak {items.length || ''}
        </Button>
      </div>
      <OutputFolder value={out} onChange={setOut} />
    </GlassPanel>
  )
}

function TranscribeMany() {
  const [paths, setPaths] = useState<string[]>([])
  const [formats, setFormats] = useState<string[]>(['txt', 'srt'])
  const [out, setOut] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const whisper = (useModels().data ?? []).some((m) => m.engine === 'whisper' && m.status === 'installed')

  const start = async () => {
    setBusy(true)
    try {
      await voxd.createBatch({ kind: 'transcribe', paths, formats, output_dir: out, speed: 1 })
      toast.success(`Queued ${paths.length} file${paths.length === 1 ? '' : 's'}`)
      setPaths([])
    } catch (e) {
      toast.error('Couldn’t start', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!whisper) return <GlassPanel className="p-5 text-[13px] text-text-2">Download a Whisper model from Models to transcribe files.</GlassPanel>

  return (
    <GlassPanel className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <Button onClick={() => void pickFiles('Choose recordings to transcribe', MEDIA).then((p) => setPaths((prev) => [...new Set([...prev, ...p])]))}>
          <FileAudio size={13} /> Choose files…
        </Button>
        <span className="text-[12px] text-text-3">Audio or video · {paths.length} selected</span>
      </div>
      {paths.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius-md)] bg-fill-control p-2 text-[12px]">
          {paths.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={p}>
                {basename(p)}
              </span>
              <button type="button" aria-label={`Remove ${basename(p)}`} onClick={() => setPaths((prev) => prev.filter((x) => x !== p))} className="text-text-3 hover:text-text-1">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-text-2">Write:</span>
        {FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={formats.includes(f)}
            onClick={() => setFormats((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))}
            className={cn('h-6 rounded-full px-2.5 text-[11px] font-semibold uppercase', formats.includes(f) ? 'bg-[var(--accent)] text-white' : 'bg-fill-control text-text-2')}
          >
            {f}
          </button>
        ))}
        <div className="flex-1" />
        <Button variant="primary" disabled={!paths.length || !formats.length || busy} onClick={() => void start()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />} Transcribe {paths.length || ''}
        </Button>
      </div>
      <OutputFolder value={out} onChange={setOut} />
    </GlassPanel>
  )
}

function WatchFolders() {
  const folders = useWatchFolders().data ?? []
  const [action, setAction] = useState<'speak' | 'transcribe'>('speak')
  const [engine, setEngine] = useState('kokoro')
  const [voice, setVoice] = useState('')
  const whisper = (useModels().data ?? []).some((m) => m.engine === 'whisper' && m.status === 'installed')

  const add = async () => {
    const path = await pickFolder(action === 'speak' ? 'Choose a folder of text files to speak' : 'Choose a folder of recordings to transcribe')
    if (!path) return
    try {
      await voxd.addWatchFolder(action === 'speak' ? { path, action, engine, voice, speed: 1, formats: [], enabled: true } : { path, action, formats: ['txt', 'srt'], speed: 1, enabled: true })
      toast.success('Watching folder', { description: path })
    } catch (e) {
      toast.error('Couldn’t watch that folder', { description: (e as Error).message })
    }
  }

  return (
    <div className="space-y-4">
      <GlassPanel className="space-y-3 p-5">
        <p className="text-[13px] text-text-2">
          VoxStudio checks watched folders every few seconds. New text files are spoken, or new recordings transcribed, and results are saved in a <strong>VoxStudio output</strong> folder inside.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            aria-label="When a file arrives"
            value={action}
            onChange={setAction}
            options={[
              { value: 'speak', label: 'Speak text files' },
              { value: 'transcribe', label: 'Transcribe recordings' },
            ]}
          />
          {action === 'speak' && (
            <div className="min-w-64 flex-1">
              <VoiceChoice engine={engine} voice={voice} onChange={(e, v) => (setEngine(e), setVoice(v))} />
            </div>
          )}
          <Button variant="primary" disabled={(action === 'speak' && !voice) || (action === 'transcribe' && !whisper)} onClick={() => void add()}>
            <FolderOpen size={13} /> Watch a folder…
          </Button>
        </div>
        {action === 'transcribe' && !whisper && <p className="text-[12px] text-[#ff9f0a]">Download a Whisper model from Models first.</p>}
      </GlassPanel>

      {folders.map((f) => (
        <WatchCard key={f.id} folder={f} />
      ))}
    </div>
  )
}

function WatchCard({ folder }: { folder: WatchFolder }) {
  const [confirm, setConfirm] = useState(false)
  const opts = folder.options as { engine?: string; voice?: string; formats?: string[] }
  const voiceName = opts.voice ? voiceLabel({ engine: opts.engine ?? '', voice: opts.voice }) : ''
  return (
    <GlassPanel className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-[10px]', folder.enabled ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]' : 'bg-fill-control text-text-3')}>
          <FolderOpen size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold" title={folder.path}>
            {basename(folder.path)}
          </div>
          <div className="truncate text-[11px] text-text-3">
            {folder.action === 'speak' ? `Speaks new .txt/.md files with ${voiceName}` : `Transcribes new recordings → ${(opts.formats ?? []).join(', ').toUpperCase()}`} · {folder.processed} processed
            {!folder.exists && ' · folder missing'}
          </div>
        </div>
        <Switch label={folder.enabled ? 'Pause' : 'Resume'} checked={folder.enabled} onChange={(on) => void voxd.setWatchFolder(folder.id, on)} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={confirm ? 'Confirm stop watching' : 'Stop watching'}
          onBlur={() => setConfirm(false)}
          onClick={() => (confirm ? void voxd.removeWatchFolder(folder.id) : setConfirm(true))}
          className={cn(confirm && 'text-[#ff453a]')}
        >
          <Trash2 size={13} />
        </Button>
      </div>
      {folder.recent.length > 0 && (
        <ul className="space-y-1 border-t-[0.5px] border-hairline pt-2 text-[12px]">
          {folder.recent.slice(0, 5).map((r) => {
            const row = r as { path: string; state: string; error?: string; at: number }
            return (
              <li key={row.path} className="flex items-center gap-2">
                {row.state === 'done' ? <CheckCircle2 size={12} className="text-[#30d158]" /> : row.state === 'error' ? <AlertTriangle size={12} className="text-[#ff453a]" /> : <Loader2 size={12} className="animate-spin text-text-3" />}
                <span className="min-w-0 flex-1 truncate">{basename(row.path)}</span>
                <span className="shrink-0 text-text-3">{row.state === 'error' ? row.error : timeAgo(row.at)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </GlassPanel>
  )
}

function BatchRow({ batch }: { batch: Batch }) {
  const running = batch.done + batch.failed < batch.total
  const pct = (batch.items.reduce((s, i) => s + (i.status === 'succeeded' || i.status === 'failed' || i.status === 'cancelled' ? 1 : i.progress), 0) / Math.max(1, batch.total)) * 100
  return (
    <GlassPanel className="space-y-2 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-[9px] bg-fill-control text-text-2">{batch.kind === 'speech' ? <Play size={13} /> : <FileAudio size={14} />}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{batch.kind === 'speech' ? 'Speak' : 'Transcribe'} · {batch.title}</div>
          <div className="text-[11px] text-text-3">
            {batch.done}/{batch.total} done{batch.failed ? ` · ${batch.failed} failed` : ''} · {timeAgo(batch.created_at)}
            {batch.output_dir && ` · saved to ${basename(batch.output_dir)}`}
          </div>
        </div>
        {running ? (
          <Button size="sm" variant="ghost" onClick={() => void voxd.cancelBatch(batch.id)}>
            <Pause size={11} /> Stop
          </Button>
        ) : (
          <Button size="icon" variant="ghost" aria-label="Remove from list" onClick={() => void voxd.deleteBatch(batch.id)}>
            <X size={13} />
          </Button>
        )}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-fill-control">
        <div className={cn('h-full rounded-full transition-[width] duration-500', batch.failed ? 'bg-[#ff9f0a]' : 'bg-[var(--accent)]')} style={{ width: `${pct}%` }} />
      </div>
      {batch.items.some((i) => i.status === 'failed') && (
        <ul className="space-y-0.5 text-[11px] text-[#ff453a]">
          {batch.items
            .filter((i) => i.status === 'failed')
            .slice(0, 3)
            .map((i) => (
              <li key={i.job_id} className="truncate">
                {i.name}: {i.error}
              </li>
            ))}
        </ul>
      )}
    </GlassPanel>
  )
}

export function BatchPage() {
  const [tab, setTab] = useState<Tab>('speak')
  const batches = useBatches().data ?? []
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Batch</h2>
          <p className="text-[14px] text-text-2">Process many texts or recordings at once — or let a folder do it automatically.</p>
        </div>
        <SegmentedControl
          aria-label="Mode"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'speak', label: 'Speak many' },
            { value: 'transcribe', label: 'Transcribe many' },
            { value: 'watch', label: 'Watch folders' },
          ]}
        />
      </header>
      {tab === 'speak' && <SpeakMany />}
      {tab === 'transcribe' && <TranscribeMany />}
      {tab === 'watch' && <WatchFolders />}
      {tab !== 'watch' && (
        <section className="space-y-2">
          <h3 className="px-1 text-[12px] font-semibold tracking-wide text-text-3">Recent batches</h3>
          {batches.length ? (
            batches.map((b) => <BatchRow key={b.id} batch={b} />)
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-text-3">
              <Layers size={26} strokeWidth={1.4} />
              <div className="text-[13px]">Batches you start appear here, with progress for every item.</div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
