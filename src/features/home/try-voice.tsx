import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Loader2, Pause, Play, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, Kbd, SegmentedControl } from '@/components/glass'
import { VoiceOrb } from '@/components/voice-orb'
import { usePlayer } from '@/lib/audio/player'
import { voxd } from '@/lib/voxd/client'
import { useEngines, useTakes, useVoices } from '@/lib/voxd/queries'
import { LONG_TEXT, useSpeechRunner } from '@/lib/voxd/use-speech'
import { usePrefs } from '@/lib/store/prefs'
import { languageName } from '@/lib/format'
import type { Take, Voice } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'

const SPEEDS = [
  { value: '0.85', label: 'Calm' },
  { value: '1', label: 'Natural' },
  { value: '1.2', label: 'Brisk' },
] as const
type Speed = (typeof SPEEDS)[number]['value']

const PROMPT = 'Welcome to VoxStudio. Every voice you hear is made right here, on your own machine.'

/** Groups voices by language, with the user's own language first. */
function groupVoices(voices: Voice[]) {
  const mine = navigator.language.split('-')[0]
  const groups = new Map<string, Voice[]>()
  for (const v of voices) groups.set(v.language, [...(groups.get(v.language) ?? []), v])
  return [...groups.entries()].sort(([a], [b]) => {
    const rank = (t: string) => (t === navigator.language ? 0 : t.startsWith(mine) ? 1 : 2)
    return rank(a) - rank(b) || languageName(a).localeCompare(languageName(b))
  })
}

const GENDER: Record<string, string> = { female: '♀', male: '♂' }

/** Each engine's standout voices, tried first when picking a default. */
const FAVORITES = ['af_heart', 'bf_emma', 'ff_siwis', 'ef_dora', 'if_sara', 'pf_dora', 'hf_alpha', 'jf_alpha', 'zf_xiaobei', 'Samantha', 'Daniel']

export function TryVoice() {
  const { engine: preferred, setEngine, voiceByEngine, setVoice: rememberVoice } = usePrefs()
  const engines = (useEngines().data ?? []).filter((e) => e.available && e.capabilities.includes('tts'))
  const engine = engines.some((e) => e.id === preferred) ? preferred : 'system'
  const voices = useVoices(engine)
  const takes = useTakes(4)
  const runner = useSpeechRunner()
  const { current, analyser, play, stop } = usePlayer()
  const [text, setText] = useState(PROMPT)
  const voice = voiceByEngine[engine] ?? ''
  const setVoice = (id: string) => rememberVoice(engine, id)
  const [speed, setSpeed] = useState<Speed>('1')

  const groups = useMemo(() => groupVoices(voices.data ?? []), [voices.data])

  // Default to the first voice in the user's language, or recover if the saved voice vanished.
  useEffect(() => {
    const all = groups.flatMap(([, list]) => list)
    if (!all.length || all.some((v) => v.id === voice)) return
    const firstGroup = groups[0][1]
    rememberVoice(engine, firstGroup.find((v) => FAVORITES.includes(v.id))?.id ?? firstGroup[0].id)
  }, [groups, voice, engine, rememberVoice])

  const playTake = (take: Take) =>
    play(take.id, voxd.audioUrl(take)).catch((e: Error) => toast.error('Playback failed', { description: e.message }))

  const busy = runner.busy
  const isLong = text.length > LONG_TEXT

  const generate = () => {
    if (!text.trim() || !voice || busy) return
    void runner.generate({ text, voice, engine, speed: Number(speed) })
  }

  const mode = busy ? 'busy' : current ? 'speaking' : 'idle'
  const status = runner.status ?? (mode === 'speaking' ? 'Speaking' : 'Ready')

  return (
    <GlassPanel className="relative overflow-hidden p-0">
      {/* Accent wash behind the orb */}
      <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-[var(--accent)] opacity-[0.10] blur-3xl" />

      <div className="relative grid grid-cols-[200px_1fr] gap-2 p-5">
        <div className="flex flex-col items-center justify-center">
          <VoiceOrb mode={mode} size={176} analyser={analyser} />
          <div className="-mt-1 text-[11px] font-medium text-text-3">
            <span className="tabular-nums">{status}</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--accent)]" />
            <h3 className="text-[14px] font-semibold">Try a voice</h3>
            <div className="flex-1" />
            {engines.length > 1 ? (
              <SegmentedControl<string>
                aria-label="Engine"
                value={engine}
                onChange={setEngine}
                options={engines.map((e) => ({ value: e.id, label: e.id === 'system' ? 'System' : e.name }))}
              />
            ) : (
              <Link to="/models" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline">
                Get natural voices <ArrowRight size={12} />
              </Link>
            )}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                generate()
              }
            }}
            rows={3}
            maxLength={200_000}
            aria-label="Text to speak"
            className="w-full resize-none rounded-[var(--radius-md)] border-[0.5px] border-hairline bg-[var(--glass-3)] px-3 py-2.5 text-[14px] leading-relaxed text-text-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)_inset] outline-none transition-shadow focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
          />

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              disabled={!groups.length}
              aria-label="Voice"
              className="h-7 max-w-[220px] rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] text-text-1 outline-none"
            >
              {!groups.length && <option>{voices.isLoading ? 'Loading voices…' : 'No voices'}</option>}
              {groups.map(([lang, list]) => (
                <optgroup key={lang} label={languageName(lang)}>
                  {list.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.gender ? ` ${GENDER[v.gender] ?? ''}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <SegmentedControl<Speed> aria-label="Pace" value={speed} onChange={setSpeed} options={[...SPEEDS]} />
            <div className="flex-1" />
            <span className={cn('text-[11px] tabular-nums', isLong ? 'text-[var(--accent)]' : 'text-text-3')}>
              {isLong ? 'Long text · renders in the background' : `${text.length} chars`}
            </span>
            <span className="hidden items-center gap-1 text-[11px] text-text-3 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>↩</Kbd>
            </span>
            {runner.jobId ? (
              <Button onClick={runner.cancel}>
                <X size={14} /> Cancel
              </Button>
            ) : (
              <Button variant="primary" onClick={() => generate()} disabled={!voice || !text.trim() || busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                Speak
              </Button>
            )}
          </div>

          {!!takes.data?.length && (
            <ul className="mt-1 space-y-1 border-t-[0.5px] border-hairline pt-3" aria-label="Recent takes">
              {takes.data.map((take) => {
                const playing = current === take.id
                return (
                  <li key={take.id} className="group flex items-center gap-2.5 rounded-[8px] px-1.5 py-1 hover:bg-fill-hover">
                    <button
                      type="button"
                      aria-label={playing ? 'Stop' : 'Play take'}
                      onClick={() => (playing ? stop() : void playTake(take))}
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full transition-colors',
                        playing ? 'bg-[var(--accent)] text-white' : 'bg-fill-control text-text-2 group-hover:text-text-1',
                      )}
                    >
                      {playing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-px" />}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[12px]">{take.text}</span>
                    <span className="shrink-0 text-[11px] text-text-3">
                      {take.engine === 'kokoro' ? take.voice.split('_').pop()?.replace(/^./, (c) => c.toUpperCase()) : take.voice} · {take.duration_s.toFixed(1)}s
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </GlassPanel>
  )
}
