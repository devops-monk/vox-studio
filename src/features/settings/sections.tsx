import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, FolderOpen, Globe, HardDrive, KeyRound, Lock, MemoryStick, RotateCcw, ShieldCheck, Sparkles, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Kbd, SegmentedControl, Switch } from '@/components/glass'
import { checkForUpdates } from '@/lib/updater'
import { VoiceOrb } from '@/components/voice-orb'
import { copyText } from '@/components/code-block'
import { ALL_NAV_ITEMS } from '@/app/nav'
import { APP_SHORTCUTS } from '@/app/shortcuts'
import { prettyShortcut } from '@/lib/dictation'
import { formatBytes } from '@/lib/format'
import { isTauri } from '@/lib/platform'
import { openExternal, revealInFinder } from '@/lib/reveal'
import { ACCENTS, usePrefs, type GlassPref, type TextSizePref, type ThemePref } from '@/lib/store/prefs'
import { voxd } from '@/lib/voxd/client'
import { useApiKeys, useEngines, useModels, useSettings, useStorage, useSystem, useUpdateSettings, useVoices } from '@/lib/voxd/queries'
import { useVoxd } from '@/lib/voxd/state'
import { cn } from '@/lib/cn'
import { Group, Row, Select } from './settings-ui'

// ------------------------------------------------------------------ General

export function General() {
  const { startPage, setAppearance, engine, setEngine, voiceByEngine, setVoice } = usePrefs()
  const engines = (useEngines().data ?? []).filter((e) => e.capabilities.includes('tts') && e.available)
  const voices = useVoices(engine).data ?? []
  const navigate = useNavigate()
  const pages = ALL_NAV_ITEMS.filter((i) => i.path !== '/settings').map((i) => [i.path, i.label] as [string, string])
  return (
    <>
      <Group>
        <Row label="Open to" hint="The page VoxStudio shows when it starts.">
          <Select label="Start page" value={startPage} onChange={(v) => setAppearance({ startPage: v })} options={pages} />
        </Row>
      </Group>
      <Group title="Quick voice" footer="Used by “Try a voice” on Home and by Quick Speak.">
        <Row label="Engine">
          <SegmentedControl<string> aria-label="Quick voice engine" value={engine} onChange={setEngine} options={engines.map((e) => ({ value: e.id, label: e.name.replace(' Voices', '') }))} />
        </Row>
        <Row label="Voice">
          <Select label="Quick voice" value={voiceByEngine[engine] ?? voices[0]?.id ?? ''} onChange={(v) => setVoice(engine, v)} options={voices.map((v) => [v.id, `${v.name} · ${v.language}`])} />
        </Row>
      </Group>
      <Group>
        <Row label="Welcome tour" hint="See the first-run introduction again.">
          <Button size="sm" onClick={() => (usePrefs.setState({ onboardingDone: false }), void navigate({ to: '/' }))}>
            Show again
          </Button>
        </Row>
      </Group>
    </>
  )
}

// ------------------------------------------------------------------ Appearance

const GLASS: { value: GlassPref; label: string; hint: string }[] = [
  { value: 'clear', label: 'Clear', hint: 'Most see-through' },
  { value: 'balanced', label: 'Balanced', hint: 'The default' },
  { value: 'frosted', label: 'Frosted', hint: 'Softer, calmer' },
  { value: 'solid', label: 'Solid', hint: 'No transparency' },
]

export function Appearance() {
  const { theme, setTheme, accent, glass, textSize, setAppearance } = usePrefs()
  return (
    <>
      <Group>
        <Row label="Theme" hint="Follow the system, or pick one.">
          <SegmentedControl<ThemePref>
            aria-label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Row>
        <Row label="Accent colour">
          <div className="flex gap-2" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={accent === a.id}
                aria-label={a.label}
                title={a.label}
                onClick={() => setAppearance({ accent: a.id })}
                className={cn('grid size-5 place-items-center rounded-full transition-transform hover:scale-110', accent === a.id && 'scale-110 shadow-[0_0_0_2px_var(--glass-2),0_0_0_3.5px_currentColor]')}
                style={{ background: a.color, color: a.color }}
              >
                {accent === a.id && <Check size={11} strokeWidth={3} className="text-white" />}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Text size">
          <SegmentedControl<TextSizePref>
            aria-label="Text size"
            value={textSize}
            onChange={(v) => setAppearance({ textSize: v })}
            options={[
              { value: 'small', label: 'Smaller' },
              { value: 'default', label: 'Default' },
              { value: 'large', label: 'Larger' },
            ]}
          />
        </Row>
      </Group>
      <Group title="Glass">
        <div className="grid grid-cols-4 gap-3 p-4">
          {GLASS.map((g) => (
            <button
              key={g.value}
              type="button"
              aria-pressed={glass === g.value}
              onClick={() => setAppearance({ glass: g.value })}
              className={cn('space-y-2 rounded-[var(--radius-md)] p-2 text-left transition-colors', glass === g.value ? 'bg-accent/12 shadow-[0_0_0_1.5px_var(--accent)]' : 'hover:bg-fill-hover')}
            >
              <div className="relative h-14 overflow-hidden rounded-[8px] bg-[linear-gradient(135deg,#5e9cff,#ff6fae_55%,#6fe3b4)]">
                <div
                  className="absolute inset-x-2 top-3 bottom-0 rounded-t-[6px] border-[0.5px] border-white/40"
                  style={{
                    background: { clear: 'rgba(255,255,255,.28)', balanced: 'rgba(255,255,255,.55)', frosted: 'rgba(255,255,255,.78)', solid: '#f6f6f8' }[g.value],
                    backdropFilter: g.value === 'solid' ? 'none' : `blur(${{ clear: 6, balanced: 10, frosted: 16 }[g.value]}px)`,
                  }}
                />
              </div>
              <div>
                <div className="text-[12px] font-medium">{g.label}</div>
                <div className="text-[10px] text-text-3">{g.hint}</div>
              </div>
            </button>
          ))}
        </div>
      </Group>
    </>
  )
}

// ------------------------------------------------------------------ Voices & models

export function VoicesModels() {
  const settings = useSettings().data
  const update = useUpdateSettings()
  const whisper = (useModels().data ?? []).filter((m) => m.engine === 'whisper' && m.status === 'installed')
  const navigate = useNavigate()
  const [mirror, setMirror] = useState('')
  useEffect(() => setMirror(settings?.model_mirror ?? ''), [settings?.model_mirror])
  if (!settings) return null
  const saveMirror = () =>
    update.mutate({ model_mirror: mirror.trim() }, { onSuccess: () => toast.success(mirror.trim() ? 'Mirror saved' : 'Using the original download sources'), onError: (e) => toast.error(e.message) })
  return (
    <>
      <Group>
        <Row label="Voice models" hint="Download, update or remove voices and speech recognition.">
          <Button size="sm" onClick={() => void navigate({ to: '/models' })}>
            Manage models
          </Button>
        </Row>
        <Row label="Transcription model" hint="Used for files, dubbing and batches. Live dictation always uses the fastest installed model.">
          <Select
            label="Transcription model"
            value={settings.asr_model ?? ''}
            onChange={(v) => update.mutate({ asr_model: v })}
            options={[['', 'Most accurate installed'], ...whisper.map((m) => [m.id, m.name] as [string, string])]}
          />
        </Row>
      </Group>
      <Group title="Download mirror" footer="For offline or firewalled setups: a server that hosts files as <model id>/<file name>. Downloads are still checked against their SHA-256, so a mirror can't swap files.">
        <div className="flex items-center gap-2 p-3">
          <input
            value={mirror}
            onChange={(e) => setMirror(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveMirror()}
            placeholder="https://models.example.com/voxstudio"
            aria-label="Mirror URL"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-[8px] bg-fill-control px-3 font-[var(--font-mono)] text-[12px] outline-none placeholder:font-[var(--font-sans)] placeholder:text-text-3"
          />
          <Button size="sm" disabled={mirror.trim() === settings.model_mirror} onClick={saveMirror}>
            Save
          </Button>
        </div>
      </Group>
    </>
  )
}

// ------------------------------------------------------------------ Performance

const DEVICE_LABEL: Record<string, string> = { auto: 'Auto', cpu: 'CPU', mps: 'Apple GPU', cuda: 'NVIDIA GPU' }

export function Performance() {
  const system = useSystem().data
  const settings = useSettings().data
  const update = useUpdateSettings()
  const [freeing, setFreeing] = useState(false)
  if (!system || !settings) return null
  const inUse = settings.compute_device_in_use
  const free = async () => {
    setFreeing(true)
    try {
      const r = await voxd.unloadEngines()
      toast.success(r.unloaded.length ? `Freed memory used by ${r.unloaded.join(', ')}` : 'Nothing was loaded')
    } finally {
      setFreeing(false)
    }
  }
  return (
    <>
      <Group>
        <Row label="Compute device" hint={`Where voice cloning runs. Auto picks the fastest available.${inUse ? ` Currently using: ${DEVICE_LABEL[inUse] ?? inUse}.` : ''}`}>
          <SegmentedControl<string>
            aria-label="Compute device"
            value={settings.compute_device}
            onChange={(v) => update.mutate({ compute_device: v })}
            options={['auto', ...system.accelerators].map((d) => ({ value: d, label: DEVICE_LABEL[d] ?? d }))}
          />
        </Row>
        <Row label="Free memory" hint="Unload voice and speech models now. They load again the next time you use them.">
          <Button size="sm" disabled={freeing} onClick={() => void free()}>
            <MemoryStick size={12} /> Free memory
          </Button>
        </Row>
      </Group>
      <Group title="This computer">
        {[
          ['Chip', system.chip],
          ['Memory', formatBytes(system.ram_bytes)],
          ['Cores', String(system.cpu_count)],
          ['System', `${system.os} ${system.os_version} (${system.arch})`],
        ].map(([k, v]) => (
          <Row key={k} label={k}>
            <span className="text-[13px] text-text-2">{v}</span>
          </Row>
        ))}
      </Group>
    </>
  )
}

// ------------------------------------------------------------------ Storage

const PART_COLOR: Record<string, string> = {
  takes: '#0a84ff',
  voices: '#bf5af2',
  dubs: '#ff375f',
  books: '#ff9f0a',
  uploads: '#30d158',
  models: '#40c8e0',
  runtimes: '#5e5ce6',
  app: '#8e8e93',
  database: '#ffd60a',
}

export function Storage() {
  const storage = useStorage()
  const settings = useSettings().data
  const system = useSystem().data
  const update = useUpdateSettings()
  const [cleaning, setCleaning] = useState(false)
  const data = storage.data
  const clean = async () => {
    setCleaning(true)
    try {
      const r = await voxd.cleanupStorage()
      toast.success(r.removed ? `Freed ${formatBytes(r.freed_bytes)}` : 'Nothing to clean up', { description: r.removed ? `${r.removed} leftover item${r.removed === 1 ? '' : 's'} removed` : undefined })
      void storage.refetch()
    } finally {
      setCleaning(false)
    }
  }
  return (
    <>
      <Group>
        <div className="space-y-3 p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-[13px] font-medium">{data ? `VoxStudio uses ${formatBytes(data.total)}` : 'Measuring…'}</div>
            {system && <div className="text-[11px] text-text-3">{formatBytes(system.disk_free_bytes)} free on this disk</div>}
          </div>
          <div className={cn('flex h-2.5 overflow-hidden rounded-full bg-fill-control', !data && 'animate-pulse')}>
            {data?.parts
              .filter((p) => p.bytes > 0)
              .map((p) => (
                <div key={p.id} title={`${p.label}: ${formatBytes(p.bytes)}`} className="h-full transition-[width] duration-500" style={{ width: `${(p.bytes / Math.max(1, data.total)) * 100}%`, background: PART_COLOR[p.id] ?? '#8e8e93' }} />
              ))}
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {data?.parts.map((p) => (
              <li key={p.id} className="group flex items-center gap-2 text-[12px]">
                <span className="size-2 shrink-0 rounded-full" style={{ background: PART_COLOR[p.id] ?? '#8e8e93' }} />
                <span className="min-w-0 flex-1 truncate">{p.label}</span>
                <span className="tabular-nums text-text-3">{formatBytes(p.bytes)}</span>
                <button type="button" aria-label={`Show ${p.label} in Finder`} onClick={() => void revealInFinder(p.path)} className="text-text-3 opacity-0 group-hover:opacity-100 hover:text-text-1 focus-visible:opacity-100">
                  <FolderOpen size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <Row label="Data folder" hint={<span className="font-[var(--font-mono)]">{data?.data_dir ?? '…'}</span>}>
          <Button size="sm" disabled={!data} onClick={() => data && void revealInFinder(data.data_dir)}>
            <FolderOpen size={12} /> Show
          </Button>
        </Row>
      </Group>
      {settings && (
        <Group>
          <Row label="Keep takes" hint="Older takes are deleted automatically. Starred takes are always kept.">
            <SegmentedControl<string>
              aria-label="Keep takes"
              value={String(settings.history_retention_days)}
              onChange={(v) => update.mutate({ history_retention_days: Number(v) }, { onSuccess: () => void storage.refetch() })}
              options={[
                { value: '0', label: 'Forever' },
                { value: '90', label: '90 days' },
                { value: '30', label: '30 days' },
                { value: '7', label: '7 days' },
              ]}
            />
          </Row>
          <Row label="Clean up leftovers" hint="Removes scratch files from interrupted work and files whose item was deleted. Nothing in your library is touched.">
            <Button size="sm" disabled={cleaning} onClick={() => void clean()}>
              <Sparkles size={12} /> Clean up
            </Button>
          </Row>
        </Group>
      )}
    </>
  )
}

// ------------------------------------------------------------------ Shortcuts

export function Shortcuts({ onDictation }: { onDictation: () => void }) {
  const shortcut = usePrefs((s) => s.dictation.shortcut)
  const pretty = prettyShortcut(shortcut)
  return (
    <>
      <Group title="Anywhere on your Mac">
        <Row label="Dictation" hint="Start and stop dictating into any app.">
          <button type="button" onClick={onDictation} className="rounded-[6px] hover:bg-fill-hover">
            <Kbd>{pretty}</Kbd>
          </button>
        </Row>
      </Group>
      <Group title="In VoxStudio">
        {APP_SHORTCUTS.map((s) => (
          <Row key={s.keys} label={s.label}>
            <Kbd>{s.keys}</Kbd>
          </Row>
        ))}
      </Group>
    </>
  )
}

// ------------------------------------------------------------------ Privacy

const HOSTS: [string, string][] = [
  ['huggingface.co', 'Voice and speech models'],
  ['github.com', 'Voice packs and engine files'],
  ['pypi.org · files.pythonhosted.org', 'Engine runtimes, installed once'],
  ['argos-net.com', 'Translation models for dubbing'],
]

export function Privacy() {
  const keys = useApiKeys().data ?? []
  const navigate = useNavigate()
  const facts: [typeof Lock, string, string][] = [
    [Lock, 'Everything runs on this computer', 'Your scripts, recordings, voices and transcripts are processed and stored locally. Nothing is uploaded.'],
    [WifiOff, 'Works offline', 'Once models are downloaded, VoxStudio doesn’t need the internet.'],
    [ShieldCheck, 'No accounts, no analytics', 'VoxStudio has no sign-in, no tracking and no telemetry.'],
    [Globe, 'Local-only API', 'The voice engine listens on 127.0.0.1 only, and every request needs the app’s token or one of your API keys.'],
  ]
  return (
    <>
      <Group>
        {facts.map(([Icon, title, body]) => (
          <div key={title} className="flex gap-3 px-4 py-3">
            <Icon size={16} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <div className="font-medium">{title}</div>
              <div className="text-[12px] text-text-3">{body}</div>
            </div>
          </div>
        ))}
      </Group>
      <Group title="The only places VoxStudio connects to" footer="Only when you download a model or install an engine. Set a mirror in Voices & Models to use your own server instead.">
        {HOSTS.map(([host, why]) => (
          <Row key={host} label={host} hint={why} />
        ))}
      </Group>
      <Group>
        <Row label="API keys" hint={keys.length ? `${keys.length} key${keys.length === 1 ? '' : 's'} can use VoxStudio from other apps on this computer.` : 'No other apps can use VoxStudio.'}>
          <Button size="sm" onClick={() => void navigate({ to: '/developer' })}>
            <KeyRound size={12} /> Manage
          </Button>
        </Row>
        <Row label="Cloned voices" hint="Each cloned voice keeps a record of the consent given when it was made.">
          <Button size="sm" onClick={() => void navigate({ to: '/voices' })}>
            Open Voices
          </Button>
        </Row>
      </Group>
    </>
  )
}

// ------------------------------------------------------------------ Logs

export function Logs() {
  const { logs, restart, state } = useVoxd()
  const [busy, setBusy] = useState(false)
  const text = logs.join('\n')
  return (
    <>
      <Group>
        <Row label="Voice engine" hint={`${state.phase === 'ready' ? 'Running' : state.phase}${state.url ? ` at ${state.url}` : ''}${state.restarts ? ` · restarted ${state.restarts}×` : ''}`}>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void restart().finally(() => setTimeout(() => setBusy(false), 1500))
            }}
          >
            <RotateCcw size={12} className={cn(busy && 'animate-spin')} /> Restart
          </Button>
        </Row>
      </Group>
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[12px] font-semibold tracking-wide text-text-3">Engine log</h3>
          <Button size="sm" variant="ghost" disabled={!text} onClick={() => void copyText(text, 'Log copied')}>
            <Copy size={12} /> Copy
          </Button>
        </div>
        <pre className="glass h-96 overflow-auto rounded-[var(--radius-lg)] p-3 font-[var(--font-mono)] text-[11px] leading-[1.55] whitespace-pre-wrap text-text-2 select-text">
          {text || (isTauri ? 'No output yet.' : 'Logs are shown in the desktop app. In the browser, voxd prints them to the terminal you started it from.')}
        </pre>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ About

const CREDITS: [string, string, string][] = [
  ['Kokoro', 'Apache-2.0', 'Natural voices (hexgrad)'],
  ['Chatterbox', 'MIT', 'Voice cloning and conversion (Resemble AI)'],
  ['Whisper · faster-whisper', 'MIT', 'Speech recognition (OpenAI · SYSTRAN)'],
  ['CTranslate2 · Argos Translate', 'MIT', 'Translation for dubbing'],
  ['PyAV · FFmpeg', 'BSD · LGPL', 'Audio and video processing'],
  ['Tauri', 'MIT / Apache-2.0', 'Desktop shell'],
  ['React · TanStack · Tailwind CSS', 'MIT', 'Interface'],
  ['FastAPI · Uvicorn', 'MIT · BSD', 'Local API'],
  ['Lucide', 'ISC', 'Icons'],
]

export function About() {
  const status = useQuery({ queryKey: ['status'], queryFn: voxd.status }).data
  const { autoUpdate, setAppearance } = usePrefs()
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <VoiceOrb mode="idle" size={72} />
        <div>
          <div className="font-[var(--font-display)] text-[22px] font-bold tracking-[-0.02em]">VoxStudio</div>
          <div className="text-[12px] text-text-3">
            Version {__APP_VERSION__} · voice engine {status?.version ?? '…'}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void openExternal('https://vox-studio.devops-monk.com')}>
            <Globe size={12} /> Website
          </Button>
          <Button size="sm" onClick={() => void openExternal('https://vox-studio.devops-monk.com/docs/')}>
            <HardDrive size={12} /> Documentation
          </Button>
        </div>
        <p className="max-w-sm text-[12px] text-text-3">Open source under the Apache License 2.0. A private voice studio that runs entirely on your computer.</p>
      </div>
      {isTauri && (
        <Group title="Updates">
          <Row label="Check automatically" hint="Once a day. Updates are signed, and install only when you choose.">
            <Switch checked={autoUpdate} onChange={(v) => setAppearance({ autoUpdate: v })} label="Check for updates automatically" />
          </Row>
          <Row label="Check now">
            <Button size="sm" onClick={() => void checkForUpdates()}>
              Check for Updates
            </Button>
          </Row>
        </Group>
      )}
      <Group title="Built with">
        {CREDITS.map(([name, license, what]) => (
          <Row key={name} label={name} hint={what}>
            <span className="shrink-0 rounded-[5px] bg-fill-control px-1.5 py-0.5 text-[10px] font-semibold text-text-2">{license}</span>
          </Row>
        ))}
      </Group>
    </>
  )
}
