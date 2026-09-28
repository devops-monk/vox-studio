import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Loader2, Mic, Play, RotateCcw, Square, Upload, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel } from '@/components/glass'
import { VoiceAvatar } from '@/components/voice-avatar'
import { VoiceOrb } from '@/components/voice-orb'
import { analyzeClip, CLONE_RATE, decodeToMono, encodeWav, peaks, type ClipQuality } from '@/lib/audio/wav'
import { usePlayer } from '@/lib/audio/player'
import { usePrefs } from '@/lib/store/prefs'
import { voxd } from '@/lib/voxd/client'
import { useCreateCustomVoice, useCustomVoices, useModels } from '@/lib/voxd/queries'
import { useSpeechRunner } from '@/lib/voxd/use-speech'
import type { CustomVoice } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { useInbox } from '@/lib/store/inbox'
import { ModelActions, ModelArt } from '@/features/models/model-parts'
import { useRecorder } from './recorder'

const READ_ALOUD = `The sun had barely risen over the hills when I set out. The air smelled of rain and cut grass, and somewhere in the distance a dog was barking. I remember thinking — this is going to be a good day.`

const CONSENT = 'I am the person in this recording, or I have their clear permission to create and use a copy of their voice.'

interface Clip {
  samples: Float32Array
  wav: Blob
  url: string
  quality: ClipQuality
  bars: number[]
}

async function toClip(data: ArrayBuffer): Promise<Clip> {
  const samples = await decodeToMono(data)
  const wav = encodeWav(samples, CLONE_RATE)
  return { samples, wav, url: URL.createObjectURL(wav), quality: analyzeClip(samples), bars: peaks(samples, 80) }
}

function Step({ n, title, done, active, children }: { n: number; title: string; done?: boolean; active?: boolean; children?: React.ReactNode }) {
  return (
    <section className={cn('transition-opacity', !active && !done && 'opacity-45')}>
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-[12px] font-semibold',
            done ? 'bg-[#30d158] text-white' : active ? 'bg-[var(--accent)] text-white' : 'bg-fill-control text-text-3',
          )}
        >
          {done ? <Check size={13} strokeWidth={3} /> : n}
        </span>
        <h3 className="text-[15px] font-semibold">{title}</h3>
      </div>
      {(active || done) && children}
    </section>
  )
}

function Meter({ level }: { level: number }) {
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: 24 }, (_, i) => {
        const on = i / 24 < level
        return (
          <span
            key={i}
            className={cn('w-1.5 rounded-full transition-all duration-75', on ? (i > 20 ? 'bg-[#ff453a]' : i > 16 ? 'bg-[#ffd60a]' : 'bg-[#30d158]') : 'bg-fill-active')}
            style={{ height: `${30 + (i / 24) * 70}%` }}
          />
        )
      })}
    </div>
  )
}

function Capture({ onClip }: { onClip: (clip: Clip) => void }) {
  const rec = useRecorder()
  const file = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [working, setWorking] = useState(false)

  const ingest = async (data: ArrayBuffer | Promise<ArrayBuffer>) => {
    setWorking(true)
    try {
      onClip(await toClip(await data))
    } catch {
      toast.error('Couldn’t read that audio', { description: 'Try a WAV, MP3 or M4A file.' })
    } finally {
      setWorking(false)
    }
  }

  const recording = rec.state === 'recording'

  return (
    <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
      <div className="rounded-[var(--radius-lg)] border-[0.5px] border-hairline bg-[var(--glass-2)] p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">Read this aloud</div>
        <p className="font-[var(--font-display)] text-[15px] leading-relaxed text-text-1">{READ_ALOUD}</p>
        <div className="mt-4 flex items-center gap-3">
          {recording ? (
            <Button variant="primary" className="bg-[#ff453a]" onClick={() => void rec.stop().then((b) => ingest(b.arrayBuffer()))}>
              <Square size={12} fill="currentColor" /> Stop · {rec.elapsed.toFixed(0)}s
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void rec.start()} disabled={rec.state === 'requesting' || working}>
              <Mic size={14} /> {rec.state === 'requesting' ? 'Allow microphone…' : 'Record'}
            </Button>
          )}
          {recording && <Meter level={rec.level} />}
        </div>
        {recording && (
          <p className="mt-2 text-[11px] text-text-3">{rec.elapsed < 10 ? 'Keep going: aim for 10–20 seconds.' : 'Great length. Stop whenever you finish the passage.'}</p>
        )}
        {rec.state === 'denied' && (
          <p className="mt-3 text-[12px] text-[#ff453a]">Microphone access was blocked. Allow it in System Settings → Privacy & Security → Microphone.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => file.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) void ingest(f.arrayBuffer())
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed p-4 text-center transition-colors',
          dragging ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--hairline-strong)] hover:bg-fill-hover',
        )}
      >
        {working ? <Loader2 size={22} className="animate-spin text-text-3" /> : <Upload size={22} strokeWidth={1.6} className="text-text-3" />}
        <span className="text-[13px] font-medium">Upload a recording</span>
        <span className="text-[11px] text-text-3">Drop a file or click · WAV, MP3, M4A · 10–60 s of one person speaking</span>
        <input
          ref={file}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void ingest(f.arrayBuffer())
            e.target.value = ''
          }}
        />
      </button>
    </div>
  )
}

function ClipReview({ clip, onRedo }: { clip: Clip; onRedo: () => void }) {
  const { current, play, stop } = usePlayer()
  const playing = current === 'clone-preview'
  const ok = !clip.quality.issues.some((i) => i.level === 'error')
  return (
    <div className="rounded-[var(--radius-lg)] border-[0.5px] border-hairline bg-[var(--glass-2)] p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play recording'}
          onClick={() => (playing ? stop() : void play('clone-preview', clip.url))}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill-control hover:bg-fill-active"
        >
          {playing ? <Square size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
        </button>
        <div className="flex h-9 flex-1 items-center gap-[2px]">
          {clip.bars.map((h, i) => (
            <span key={i} className="flex-1 rounded-full bg-[var(--accent)]/70" style={{ height: `${Math.max(8, h * 100)}%` }} />
          ))}
        </div>
        <span className="text-[12px] tabular-nums text-text-2">{clip.quality.duration.toFixed(1)}s</span>
        <Button variant="ghost" size="sm" onClick={onRedo}>
          <RotateCcw size={12} /> Redo
        </Button>
      </div>
      <ul className="mt-3 space-y-1">
        {clip.quality.issues.length === 0 && (
          <li className="flex items-center gap-2 text-[12px] text-[#30d158]">
            <CheckCircle2 size={14} /> Great recording: clear, a good length, no distortion.
          </li>
        )}
        {clip.quality.issues.map((issue) => (
          <li key={issue.message} className={cn('flex items-center gap-2 text-[12px]', issue.level === 'error' ? 'text-[#ff453a]' : 'text-[#ff9f0a]')}>
            <AlertTriangle size={13} /> {issue.message}
          </li>
        ))}
      </ul>
      {!ok && <p className="mt-2 text-[11px] text-text-3">Fix the issue above before continuing.</p>}
    </div>
  )
}

function TryNewVoice({ voice }: { voice: CustomVoice }) {
  const navigate = useNavigate()
  const { setEngine, setVoice } = usePrefs()
  const runner = useSpeechRunner()
  const { current, analyser } = usePlayer()
  const [text, setText] = useState(`Hi, this is ${voice.name}. I can read anything you write, in my own voice.`)
  return (
    <div className="flex items-center gap-5 rounded-[var(--radius-lg)] border-[0.5px] border-hairline bg-[var(--glass-2)] p-4">
      <VoiceOrb mode={runner.busy ? 'busy' : current ? 'speaking' : 'idle'} size={110} analyser={analyser} />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-center gap-2">
          <VoiceAvatar id={voice.id} name={voice.name} size={22} />
          <span className="text-[14px] font-semibold">{voice.name} is ready</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          aria-label="Test sentence"
          className="w-full resize-none rounded-[var(--radius-md)] border-[0.5px] border-hairline bg-[var(--glass-3)] px-3 py-2 text-[13px] outline-none"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            disabled={runner.busy || !text.trim()}
            onClick={() => void runner.generate({ text, voice: voice.id, engine: 'chatterbox', speed: 1, title: `Test · ${voice.name}` })}
          >
            {runner.busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
            {runner.status ?? 'Hear it'}
          </Button>
          <Button
            onClick={() => {
              setEngine('chatterbox')
              setVoice('chatterbox', voice.id)
              void navigate({ to: '/studio' })
            }}
          >
            Use in Studio <ArrowRight size={13} />
          </Button>
          {runner.busy && <span className="text-[11px] text-text-3">The first line takes longest while the engine warms up.</span>}
        </div>
      </div>
    </div>
  )
}

export function ClonePage() {
  const models = useModels().data
  const chatterbox = models?.find((m) => m.engine === 'chatterbox')
  const ready = chatterbox?.status === 'installed'
  const create = useCreateCustomVoice()
  const existing = useCustomVoices().data ?? []

  const [clip, setClip] = useState<Clip | null>(null)
  const [name, setName] = useState('')
  // A recording dropped anywhere in the app ("Clone this voice").
  useEffect(() => {
    const dropped = useInbox.getState().take('clone')
    if (!dropped) return
    dropped
      .arrayBuffer()
      .then(toClip)
      .then(
        (c) => (setClip(c), setName((n) => n || dropped.name.replace(/\.[^.]+$/, '').slice(0, 40))),
        () => toast.error('Couldn’t read that audio', { description: 'Try a WAV, MP3 or M4A file.' }),
      )
  }, [])
  const [consented, setConsented] = useState(false)
  const [consentBy, setConsentBy] = useState('')
  const [created, setCreated] = useState<CustomVoice | null>(null)

  useEffect(() => () => void (clip && URL.revokeObjectURL(clip.url)), [clip])

  const clipOk = !!clip && !clip.quality.issues.some((i) => i.level === 'error')
  const reset = () => {
    setClip(null)
    setCreated(null)
    setName('')
    setConsentBy('')
    setConsented(false)
  }

  const submit = () => {
    if (!clip || !name.trim() || !consented) return
    create.mutate(
      { name: name.trim(), consent: CONSENT, consentBy: consentBy.trim(), audio: clip.wav },
      { onSuccess: setCreated, onError: (e) => toast.error('Couldn’t create the voice', { description: e.message }) },
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
      <header>
        <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Clone a voice</h2>
        <p className="text-[14px] text-text-2">Record or upload 10–20 seconds of someone speaking, and VoxStudio will speak in their voice.</p>
      </header>

      {chatterbox && !ready && (
        <GlassPanel className="flex items-center gap-4 p-5">
          <ModelArt model={chatterbox} size={52} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">Voice cloning needs Chatterbox</div>
            <div className="text-[12px] text-text-2">A one-time download of the cloning model and its engine. It runs entirely on this computer.</div>
          </div>
          <div className="w-72">
            <ModelActions model={chatterbox} />
          </div>
        </GlassPanel>
      )}

      <GlassPanel className={cn('space-y-7 p-6', !ready && 'pointer-events-none opacity-50')} aria-disabled={!ready}>
        <Step n={1} title="Capture a sample" active={!clip} done={!!clip}>
          {clip ? <ClipReview clip={clip} onRedo={reset} /> : <Capture onClip={setClip} />}
        </Step>

        <Step n={2} title="Name it and confirm consent" active={clipOk && !created} done={!!created}>
          {!created && (
            <div className="space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="Voice name, e.g. “My narrator voice”"
                aria-label="Voice name"
                className="h-9 w-full rounded-[var(--radius-md)] border-[0.5px] border-hairline bg-[var(--glass-3)] px-3 text-[13px] outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
              />
              <input
                value={consentBy}
                onChange={(e) => setConsentBy(e.target.value)}
                maxLength={120}
                placeholder="Whose voice is this? (optional, saved with the consent record)"
                aria-label="Speaker"
                className="h-9 w-full rounded-[var(--radius-md)] border-[0.5px] border-hairline bg-[var(--glass-3)] px-3 text-[13px] outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
              />
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] bg-fill-control p-3 text-[12px] leading-relaxed text-text-1">
                <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
                <span>
                  {CONSENT}
                  <span className="mt-1 block text-[11px] text-text-3">
                    This statement is saved with the voice. Everything Chatterbox generates carries an inaudible watermark marking it as AI-made.
                  </span>
                </span>
              </label>
              <Button variant="primary" onClick={submit} disabled={!name.trim() || !consented || create.isPending}>
                {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Create voice
              </Button>
            </div>
          )}
        </Step>

        <Step n={3} title="Try it out" active={!!created}>
          {created && (
            <div className="space-y-3">
              <TryNewVoice voice={created} />
              <Button variant="ghost" size="sm" onClick={reset}>
                Clone another voice
              </Button>
            </div>
          )}
        </Step>
      </GlassPanel>

      {!!existing.length && (
        <section className="space-y-2">
          <h3 className="px-1 text-[12px] font-semibold tracking-wide text-text-3">Your voices</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {existing.map((v) => (
              <VoiceChip key={v.id} voice={v} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function VoiceChip({ voice }: { voice: CustomVoice }) {
  const { current, play, stop } = usePlayer()
  const key = `ref-${voice.id}`
  return (
    <button
      type="button"
      onClick={() => (current === key ? stop() : void play(key, voxd.audioUrl(voice)))}
      className="glass flex items-center gap-2.5 rounded-[var(--radius-md)] p-2.5 text-left transition-transform hover:-translate-y-0.5"
      title="Play the original recording"
    >
      <VoiceAvatar id={voice.id} name={voice.name} size={30} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{voice.name}</span>
        <span className="block text-[11px] text-text-3">{current === key ? 'Playing sample…' : `${voice.duration_s.toFixed(0)}s sample`}</span>
      </span>
    </button>
  )
}
