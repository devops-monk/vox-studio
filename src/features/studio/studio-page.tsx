import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AudioLines, Loader2, Play, Sparkles, X } from 'lucide-react'
import { Button, Kbd, SegmentedControl, Slider } from '@/components/glass'
import { VoiceOrb } from '@/components/voice-orb'
import { usePlayer } from '@/lib/audio/player'
import { usePrefs } from '@/lib/store/prefs'
import { useStudio } from '@/lib/store/studio'
import { useCustomVoices, useDesignedVoices, useEngines, useTakes, useVoices } from '@/lib/voxd/queries'
import { LONG_TEXT, useSpeechRunner } from '@/lib/voxd/use-speech'
import { cn } from '@/lib/cn'
import { TakeCard } from './take-card'
import { VoicePicker } from './voice-picker'
import { HAS_MARKUP, MarkupEditor } from './markup-editor'

const PLACEHOLDER = `Paste or write your script here.

Tip: select words and use the buttons above to add pauses, change the pace, stress a word or fix a pronunciation.`

const fmtSeconds = (secs: number) => (secs < 60 ? `${Math.round(secs)}s` : `${Math.floor(secs / 60)}m ${String(Math.round(secs % 60)).padStart(2, '0')}s`)

/** Rough speaking time at a natural pace (~155 words per minute). */
function estimate(text: string, speed: number) {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const secs = Math.round((words / 155) * 60 / speed)
  return { words, label: secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s` }
}

export function StudioPage() {
  const { text, setText, speed, setSpeed, emotion, setEmotion, markup, setMarkup } = useStudio()
  const [markupSeconds, setMarkupSeconds] = useState<number | null>(null)
  const { engine: preferred, setEngine, voiceByEngine, setVoice } = usePrefs()
  const engines = (useEngines().data ?? []).filter((e) => e.available && e.capabilities.includes('tts'))
  const engine = engines.find((e) => e.id === preferred) ?? engines.find((e) => e.id === 'kokoro') ?? engines[0]
  const engineId = engine?.id ?? 'system'
  const voices = useVoices(engineId).data ?? []
  const voice = voiceByEngine[engineId] ?? ''
  const takes = useTakes(30).data ?? []
  const custom = useCustomVoices().data ?? []
  const designed = useDesignedVoices().data ?? []
  const runner = useSpeechRunner()
  const { current, analyser } = usePlayer()
  const cloning = !!engine?.capabilities.includes('clone')
  const emotive = !!engine?.capabilities.includes('emotion')
  const est = useMemo(() => estimate(text, speed), [text, speed])

  // Keep a valid voice selected for the current engine.
  useEffect(() => {
    if (voices.length && !voices.some((v) => v.id === voice)) setVoice(engineId, voices[0].id)
  }, [voices, voice, engineId, setVoice])

  const generate = () => {
    if (!text.trim() || !voice || runner.busy) return
    void runner.generate({ text, voice, engine: engineId, speed, emotion: emotive ? emotion : null, markup: markup && HAS_MARKUP.test(text) })
  }

  const orbMode = runner.busy ? 'busy' : current ? 'speaking' : 'idle'

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
          <section className="glass overflow-hidden rounded-[var(--radius-xl)]">
            <MarkupEditor
              value={text}
              onChange={setText}
              onSubmit={generate}
              placeholder={PLACEHOLDER}
              markup={markup}
              onMarkup={setMarkup}
              speed={speed}
              onEstimate={setMarkupSeconds}
            />
            <div className="flex items-center gap-3 border-t-[0.5px] border-hairline bg-[var(--glass-1)] px-4 py-2.5">
              <span className="text-[12px] tabular-nums text-text-3">
                {est.words} words · ~{markupSeconds != null ? fmtSeconds(markupSeconds) : est.label}
              </span>
              {text.length > LONG_TEXT && <span className="text-[12px] text-[var(--accent)]">Renders in the background</span>}
              <div className="flex-1" />
              {runner.status && <span className="text-[12px] tabular-nums text-text-2">{runner.status}</span>}
              <span className="hidden items-center gap-1 lg:flex">
                <Kbd>⌘</Kbd>
                <Kbd>↩</Kbd>
              </span>
              {runner.jobId ? (
                <Button onClick={runner.cancel}>
                  <X size={14} /> Cancel
                </Button>
              ) : (
                <Button variant="primary" onClick={generate} disabled={!text.trim() || !voice || runner.busy}>
                  {runner.busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                  Generate
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-3" aria-label="Takes">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[12px] font-semibold tracking-wide text-text-3">Takes</h3>
              {!!takes.length && <span className="text-[11px] text-text-3">{takes.length} recent</span>}
            </div>
            {takes.length ? (
              takes.map((t) => <TakeCard key={t.id} take={t} custom={custom} designed={designed} />)
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--hairline-strong)] px-6 py-10 text-center">
                <AudioLines size={26} strokeWidth={1.4} className="text-text-3" />
                <div className="text-[13px] font-medium text-text-2">Your takes will appear here</div>
                <div className="text-[12px] text-text-3">Write something above and press Generate.</div>
              </div>
            )}
          </section>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col gap-4 border-l-[0.5px] border-hairline bg-[var(--glass-1)] p-4" aria-label="Voice settings">
        <div className="flex items-center gap-3">
          <VoiceOrb mode={orbMode} size={56} analyser={analyser} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{voices.find((v) => v.id === voice)?.name ?? 'Pick a voice'}</div>
            <div className="text-[11px] text-text-3">{engine?.name ?? '—'}</div>
          </div>
        </div>

        {engines.length > 1 && (
          <SegmentedControl<string>
            aria-label="Engine"
            value={engineId}
            onChange={setEngine}
            options={engines.map((e) => ({ value: e.id, label: e.id === 'system' ? 'System' : e.name }))}
          />
        )}

        <VoicePicker engine={engineId} value={voice} onChange={(v) => setVoice(engineId, v)} cloning={cloning} />

        <div className="space-y-4 border-t-[0.5px] border-hairline pt-4">
          <Slider label="Pace" value={speed} min={0.6} max={1.6} step={0.05} onChange={setSpeed} format={(v) => `${v.toFixed(2)}×`} ends={['Slower', 'Faster']} />
          <Slider
            label="Emotion"
            value={emotion}
            min={0}
            max={1}
            step={0.05}
            onChange={setEmotion}
            format={(v) => (v < 0.35 ? 'Calm' : v > 0.65 ? 'Intense' : 'Natural')}
            ends={['Calm', 'Intense']}
            disabled={!emotive}
            hint={emotive ? undefined : `${engine?.name ?? 'This engine'} doesn’t support emotion.`}
          />
          {!engines.some((e) => e.capabilities.includes('clone')) && (
            <Link
              to="/models"
              className={cn('flex items-center gap-2 rounded-[10px] bg-fill-control px-3 py-2 text-[12px] text-text-2 transition-colors hover:bg-fill-hover')}
            >
              <Sparkles size={13} className="text-[var(--accent)]" /> Clone voices with Chatterbox →
            </Link>
          )}
        </div>
      </aside>
    </div>
  )
}
