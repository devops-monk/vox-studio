import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Loader2, Pause, Play, RotateCcw, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, Slider } from '@/components/glass'
import { VoiceAvatar } from '@/components/voice-avatar'
import { VoiceOrb } from '@/components/voice-orb'
import { usePlayer } from '@/lib/audio/player'
import { usePrefs } from '@/lib/store/prefs'
import { voxd } from '@/lib/voxd/client'
import { useDesignAnalyze, useDesignStatus, useDesignedVoices, useJob, useModels, useSaveDesigned } from '@/lib/voxd/queries'
import { useVoxd } from '@/lib/voxd/state'
import type { DesignCandidate } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { DownloadBar, ModelActions, ModelArt } from '@/features/models/model-parts'

const EXAMPLES = [
  'A warm, deep British narrator, calm and measured',
  'An energetic young woman, bright and upbeat',
  'A gentle, soothing voice for bedtime stories',
  'A crisp, clear American newsreader',
  'A deep, relaxed late-night radio host',
]
const LETTERS = ['A', 'B', 'C', 'D']
const TRAIT_NAMES = ['Depth', 'Warmth', 'Energy'] as const
type Sliders = { depth: number | null; warmth: number | null; energy: number | null }

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Short spoken samples, cached per voice + line so re-listening is instant. */
const previews = new Map<string, Promise<{ id: string; url: string }>>()
function previewFor(recipe: string, line: string, speed: number) {
  const key = `${recipe}|${line}|${speed}`
  let p = previews.get(key)
  if (!p) {
    p = voxd.speak({ text: line, voice: recipe, engine: 'kokoro', speed }).then((take) => ({ id: take.id, url: voxd.audioUrl(take) }))
    p.catch(() => previews.delete(key))
    previews.set(key, p)
  }
  return p
}

function TraitBars({ traits }: { traits: number[] }) {
  return (
    <div className="space-y-1.5">
      {TRAIT_NAMES.map((name, i) => (
        <div key={name} className="flex items-center gap-2">
          <span className="w-12 text-[10px] text-text-3">{name}</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-fill-control">
            <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${Math.round(traits[i] * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function CandidateCard({
  c,
  index,
  selected,
  onSelect,
  line,
  speed,
}: {
  c: DesignCandidate
  index: number
  selected: boolean
  onSelect: () => void
  line: string
  speed: number
}) {
  const { current, play, stop } = usePlayer()
  const [loading, setLoading] = useState(false)
  const key = `design-${c.recipe}`
  const playing = current === key

  const listen = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (playing) return stop()
    setLoading(true)
    try {
      const { url } = await previewFor(c.recipe, line, speed)
      await play(key, url)
    } catch (err) {
      toast.error('Preview failed', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      className={cn(
        'glass relative flex cursor-pointer flex-col gap-3 rounded-[var(--radius-lg)] p-4 transition-all duration-200 ease-[var(--ease-spring)] animate-[pop-in_300ms_var(--ease-spring)_both] hover:-translate-y-0.5',
        selected && 'shadow-[0_0_0_2px_var(--accent),var(--shadow-card)]',
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex h-9 items-center gap-3">
        <VoiceAvatar id={c.recipe} name={LETTERS[index]} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Voice {LETTERS[index]}</div>
          <div className="text-[11px] text-text-3">{Math.round(c.score * 100)}% match</div>
        </div>
        {selected && (
          <span className="flex size-5 items-center justify-center rounded-full bg-[var(--accent)] text-white">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </div>
      <TraitBars traits={c.traits} />
      <Button size="sm" onClick={(e) => void listen(e)} className="w-full justify-center">
        {loading ? <Loader2 size={12} className="animate-spin" /> : playing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
        {playing ? 'Stop' : 'Listen'}
      </Button>
    </div>
  )
}

function Prepare() {
  const status = useDesignStatus().data
  const analyze = useDesignAnalyze()
  const job = useJob(status?.job_id ?? null).data
  const running = !!status?.job_id
  return (
    <GlassPanel className="flex flex-col items-center gap-3 px-8 py-10 text-center">
      <VoiceOrb mode={running ? 'busy' : 'idle'} size={120} />
      <h3 className="text-[17px] font-semibold">{running ? 'Getting to know the voices…' : 'Set up voice design'}</h3>
      <p className="max-w-md text-[13px] text-text-2">
        VoxStudio designs new voices by blending Kokoro’s voices. First it listens to each one to learn how deep, warm and lively it sounds.
        This takes about a minute, once.
      </p>
      {running ? (
        <div className="mt-2 w-full max-w-sm">
          <DownloadBar progress={job?.progress ?? 0} message={job?.message ?? 'Starting…'} />
        </div>
      ) : (
        <Button variant="primary" className="mt-2" onClick={() => analyze.mutate(undefined, { onError: (e) => toast.error(e.message) })} disabled={analyze.isPending}>
          <Sparkles size={14} /> Analyze voices
        </Button>
      )}
    </GlassPanel>
  )
}

function DesignedList() {
  const designed = useDesignedVoices().data ?? []
  const navigate = useNavigate()
  const { setEngine, setVoice } = usePrefs()
  const { current, play, stop } = usePlayer()
  const [confirm, setConfirm] = useState<string | null>(null)
  if (!designed.length) return null
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-[12px] font-semibold tracking-wide text-text-3">Your designed voices</h3>
      <div className="glass divide-y-[0.5px] divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-lg)]">
        {designed.map((v) => {
          const key = `designed-${v.id}`
          return (
            <div key={v.id} className="group flex items-center gap-3 px-4 py-2.5">
              <VoiceAvatar id={v.id} name={v.name} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{v.name}</div>
                <div className="truncate text-[11px] text-text-3">{v.description || 'Designed voice'}</div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={current === key ? 'Stop' : `Play ${v.name}`}
                onClick={() =>
                  current === key ? stop() : void previewFor(v.id, `Hi, I'm ${v.name}.`, 1).then(({ url }) => play(key, url))
                }
              >
                {current === key ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEngine('kokoro')
                  setVoice('kokoro', v.id)
                  void navigate({ to: '/studio' })
                }}
              >
                Use <ArrowRight size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={confirm === v.id ? `Confirm delete ${v.name}` : `Delete ${v.name}`}
                onBlur={() => setConfirm(null)}
                onClick={() => (confirm === v.id ? void voxd.deleteDesigned(v.id).then(() => toast(`${v.name} deleted`)) : setConfirm(v.id))}
                className={cn('opacity-0 group-hover:opacity-100 focus-visible:opacity-100', confirm === v.id && 'text-[#ff453a] opacity-100')}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function DesignPage() {
  const ready = useVoxd((s) => s.state.phase === 'ready')
  const models = useModels().data
  const kokoro = models?.find((m) => m.engine === 'kokoro')
  const status = useDesignStatus().data
  const save = useSaveDesigned()
  const navigate = useNavigate()
  const { setEngine, setVoice } = usePrefs()

  const [description, setDescription] = useState(EXAMPLES[0])
  const [sliders, setSliders] = useState<Sliders>({ depth: null, warmth: null, energy: null })
  const [line, setLine] = useState('Every voice tells a story. Here is how mine sounds.')
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pace, setPace] = useState(1)
  const input = useRef<HTMLTextAreaElement>(null)

  const request = useDebounced({ description, ...sliders }, 300)
  const result = useQuery({
    queryKey: ['design', request],
    queryFn: () => voxd.designCandidates(request),
    enabled: ready && !!status?.ready && request.description.trim().length > 0,
    placeholderData: (prev) => prev,
    staleTime: Infinity,
  })
  const candidates = result.data?.candidates ?? []
  const target = result.data?.target
  const chosen = candidates.find((c) => c.recipe === selected) ?? null

  useEffect(() => {
    if (candidates.length && !candidates.some((c) => c.recipe === selected)) setSelected(candidates[0].recipe)
  }, [candidates, selected])

  // Sliders show what the description asked for until you move them.
  const shown = useMemo(
    () => ({
      depth: sliders.depth ?? target?.depth ?? 0.5,
      warmth: sliders.warmth ?? target?.warmth ?? 0.5,
      energy: sliders.energy ?? target?.energy ?? 0.5,
    }),
    [sliders, target],
  )
  const understood = useMemo(() => {
    if (!target) return []
    const out: string[] = []
    if (target.gender) out.push(target.gender === 'female' ? 'Female' : 'Male')
    if (target.language) out.push(target.language === 'en-GB' ? 'British' : 'American')
    if (target.depth != null) out.push(target.depth > 0.5 ? 'Deep' : 'Light')
    if (target.warmth != null) out.push(target.warmth > 0.5 ? 'Warm' : 'Crisp')
    if (target.energy != null) out.push(target.energy > 0.5 ? 'Lively' : 'Calm')
    if (target.speed !== 1) out.push(target.speed > 1 ? 'Quick' : 'Unhurried')
    return out
  }, [target])

  useEffect(() => {
    if (target) setPace(target.speed)
  }, [target?.speed]) // eslint-disable-line react-hooks/exhaustive-deps

  const kokoroReady = kokoro?.status === 'installed'

  const onSave = () => {
    if (!chosen || !name.trim()) return
    save.mutate(
      { name: name.trim(), recipe: chosen.recipe, description, speed: pace },
      {
        onSuccess: (v) =>
          toast.success(`${v.name} saved`, {
            action: {
              label: 'Use in Studio',
              onClick: () => {
                setEngine('kokoro')
                setVoice('kokoro', v.id)
                void navigate({ to: '/studio' })
              },
            },
          }),
        onError: (e) => toast.error('Couldn’t save', { description: e.message }),
      },
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-8">
      <header>
        <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Design a voice</h2>
        <p className="text-[14px] text-text-2">Describe the voice you imagine. VoxStudio blends its voices to match, and you fine-tune by ear.</p>
      </header>

      {kokoro && !kokoroReady && (
        <GlassPanel className="flex items-center gap-4 p-5">
          <ModelArt model={kokoro} size={52} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">Voice design uses Kokoro</div>
            <div className="text-[12px] text-text-2">Download it once, and design as many voices as you like.</div>
          </div>
          <div className="w-72">
            <ModelActions model={kokoro} />
          </div>
        </GlassPanel>
      )}

      {kokoroReady && status && !status.ready && <Prepare />}

      {kokoroReady && status?.ready && (
        <>
          <GlassPanel className="space-y-3 p-5">
            <textarea
              ref={input}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              aria-label="Describe a voice"
              placeholder="Describe a voice: who is speaking, how they sound, and how they feel…"
              className="w-full resize-none bg-transparent font-[var(--font-display)] text-[20px] leading-snug tracking-[-0.01em] text-text-1 outline-none placeholder:text-text-3"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {understood.length ? (
                <>
                  <span className="text-[11px] text-text-3">Understood:</span>
                  {understood.map((u) => (
                    <span key={u} className="rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                      {u}
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-[11px] text-text-3">Try words like warm, deep, British, calm, energetic, young, crisp…</span>
              )}
              {result.isFetching && <Loader2 size={12} className="animate-spin text-text-3" />}
            </div>
            <div className="flex flex-wrap gap-1.5 border-t-[0.5px] border-hairline pt-3">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setDescription(ex)
                    setSliders({ depth: null, warmth: null, energy: null })
                  }}
                  className={cn('rounded-full px-2.5 py-1 text-[11px] transition-colors', ex === description ? 'bg-[var(--accent)] text-white' : 'bg-fill-control text-text-2 hover:bg-fill-hover')}
                >
                  {ex}
                </button>
              ))}
            </div>
          </GlassPanel>

          <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
            <section className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-[12px] font-semibold tracking-wide text-text-3">Candidates</h3>
                <div className="flex-1" />
                <input
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  aria-label="Preview line"
                  className="h-7 w-72 rounded-[8px] bg-fill-control px-2.5 text-[12px] text-text-1 outline-none"
                />
              </div>
              <div role="radiogroup" aria-label="Candidates" className="grid grid-cols-2 gap-3">
                {candidates.map((c, i) => (
                  <CandidateCard key={c.recipe} c={c} index={i} selected={c.recipe === selected} onSelect={() => setSelected(c.recipe)} line={line} speed={pace} />
                ))}
              </div>
            </section>

            <aside className="space-y-4">
              <GlassPanel className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold">Fine-tune</h3>
                  {(sliders.depth ?? sliders.warmth ?? sliders.energy) != null && (
                    <Button variant="ghost" size="sm" onClick={() => setSliders({ depth: null, warmth: null, energy: null })}>
                      <RotateCcw size={11} /> Reset
                    </Button>
                  )}
                </div>
                <Slider label="Depth" value={shown.depth} min={0} max={1} step={0.05} onChange={(v) => setSliders((s) => ({ ...s, depth: v }))} format={(v) => (v > 0.6 ? 'Deep' : v < 0.4 ? 'Light' : 'Balanced')} ends={['Light', 'Deep']} />
                <Slider label="Warmth" value={shown.warmth} min={0} max={1} step={0.05} onChange={(v) => setSliders((s) => ({ ...s, warmth: v }))} format={(v) => (v > 0.6 ? 'Warm' : v < 0.4 ? 'Crisp' : 'Balanced')} ends={['Crisp', 'Warm']} />
                <Slider label="Energy" value={shown.energy} min={0} max={1} step={0.05} onChange={(v) => setSliders((s) => ({ ...s, energy: v }))} format={(v) => (v > 0.6 ? 'Lively' : v < 0.4 ? 'Calm' : 'Balanced')} ends={['Calm', 'Lively']} />
                <Slider label="Pace" value={pace} min={0.8} max={1.2} step={0.02} onChange={setPace} format={(v) => `${v.toFixed(2)}×`} ends={['Unhurried', 'Quick']} />
              </GlassPanel>

              <GlassPanel className="space-y-3 p-4">
                <h3 className="text-[13px] font-semibold">Save {chosen ? `Voice ${LETTERS[candidates.indexOf(chosen)]}` : 'a voice'}</h3>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSave()}
                  placeholder="Name it, e.g. “Harbour Narrator”"
                  aria-label="Voice name"
                  maxLength={60}
                  className="h-8 w-full rounded-[8px] border-[0.5px] border-hairline bg-[var(--glass-3)] px-2.5 text-[12px] outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
                />
                <Button variant="primary" className="w-full justify-center" disabled={!chosen || !name.trim() || save.isPending} onClick={onSave}>
                  {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Save voice
                </Button>
              </GlassPanel>
            </aside>
          </div>
        </>
      )}

      <DesignedList />
    </div>
  )
}
