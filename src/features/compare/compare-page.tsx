import { useEffect, useMemo, useState } from 'react'
import { Crown, Loader2, Play, RotateCcw, Scale, Shuffle, Sparkles, Square, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, Kbd, Switch } from '@/components/glass'
import { usePlayer } from '@/lib/audio/player'
import { usePrefs } from '@/lib/store/prefs'
import { voxd } from '@/lib/voxd/client'
import { useCustomVoices, useEngines, useLeaderboard, useVoices } from '@/lib/voxd/queries'
import type { Take } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'

const LANGUAGES: Record<string, string> = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', hi: 'Hindi', ja: 'Japanese', zh: 'Chinese' }
const SAMPLES: Record<string, string[]> = {
  en: ['The quick brown fox jumps over the lazy dog, then naps in the afternoon sun.', 'Welcome back! Your order has shipped and should arrive on Thursday.', 'I never said she stole my money — but somebody certainly did.'],
  es: ['Buenos días. Hoy vamos a hablar de cómo preparar un café perfecto.', 'La reunión empieza a las tres; por favor, no llegues tarde.'],
  fr: ['Bonjour ! Aujourd’hui, nous allons découvrir les secrets de la cuisine provençale.', 'Le train de dix-huit heures est en retard de vingt minutes.'],
  de: ['Guten Morgen! Heute sprechen wir über die schönsten Wanderwege der Alpen.', 'Bitte schließen Sie die Tür, bevor Sie das Büro verlassen.'],
  it: ['Buongiorno! Oggi parliamo della vera ricetta della pasta al pomodoro.', 'Il museo resta aperto fino alle dieci di sera.'],
  pt: ['Bom dia! Hoje vamos conhecer as praias mais bonitas do litoral.', 'O próximo ônibus sai em quinze minutos.'],
  hi: ['नमस्ते! आज हम सीखेंगे कि अच्छी चाय कैसे बनाई जाती है।'],
  ja: ['こんにちは。今日は美味しいお茶の入れ方についてお話しします。'],
  zh: ['大家好，今天我们来聊一聊如何泡一杯好茶。'],
}
const MAX_PAIRS = 10

interface Candidate {
  key: string
  engine: string
  voice: string
  name: string
  language: string
}
type Phase = 'setup' | 'rendering' | 'rating' | 'results'

const lang = (code: string) => code.toLowerCase().split(/[-_]/)[0]

function useCandidates() {
  const engines = useEngines().data ?? []
  const up = (id: string) => engines.some((e) => e.id === id && e.available)
  const kokoro = useVoices(up('kokoro') ? 'kokoro' : '').data ?? []
  const system = useVoices(up('system') ? 'system' : '').data ?? []
  const custom = useCustomVoices().data ?? []
  return useMemo<Candidate[]>(
    () => [
      ...kokoro.map((v) => ({ key: `kokoro|${v.id}`, engine: 'kokoro', voice: v.id, name: v.name, language: lang(v.language) })),
      ...(up('chatterbox') ? custom.map((v) => ({ key: `chatterbox|${v.id}`, engine: 'chatterbox', voice: v.id, name: v.name, language: lang(v.language) })) : []),
      ...system.map((v) => ({ key: `system|${v.id}`, engine: 'system', voice: v.id, name: v.name, language: lang(v.language) })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kokoro, system, custom, engines],
  )
}

const ENGINE_LABEL: Record<string, string> = { kokoro: 'Natural', chatterbox: 'Your voice', system: 'System' }

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function Leaderboard({ language, names }: { language: string; names: Map<string, string> }) {
  const board = useLeaderboard(language).data
  if (!board?.voices.length)
    return <p className="text-[12px] text-text-3">No ratings in {LANGUAGES[language] ?? language} yet. Run a blind test to find out which voice you really prefer.</p>
  return (
    <ol className="space-y-1.5">
      {board.voices.slice(0, 8).map((v, i) => (
        <li key={`${v.engine}|${v.voice}`} className="flex items-center gap-2.5 text-[12px]">
          <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', i === 0 ? 'bg-[#ffcc00] text-black' : 'bg-fill-control text-text-2')}>{i + 1}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{names.get(`${v.engine}|${v.voice}`) ?? v.voice}</span>
          <span className="text-[10px] text-text-3">{ENGINE_LABEL[v.engine] ?? v.engine}</span>
          <span className="w-16 text-right tabular-nums text-text-3">
            {v.wins}–{v.losses}
            {v.ties ? `–${v.ties}` : ''}
          </span>
          <span className="w-10 text-right font-semibold tabular-nums">{Math.round(v.score)}</span>
        </li>
      ))}
      <li className="pt-1 text-[10px] text-text-3">{board.ratings} comparisons · Elo score, wins–losses–ties</li>
    </ol>
  )
}

export function ComparePage() {
  const candidates = useCandidates()
  const names = useMemo(() => new Map(candidates.map((c) => [c.key, c.name])), [candidates])
  const languages = useMemo(() => [...new Set(candidates.map((c) => c.language))].filter((l) => l in LANGUAGES), [candidates])
  const [language, setLanguage] = useState('en')
  const [text, setText] = useState(SAMPLES.en[0])
  const [picked, setPicked] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>('setup')
  const [renderDone, setRenderDone] = useState(0)
  const [takes, setTakes] = useState<Record<string, Take>>({})
  const [pairs, setPairs] = useState<[Candidate, Candidate][]>([])
  const [round, setRound] = useState(0)
  const [heard, setHeard] = useState<{ a: boolean; b: boolean }>({ a: false, b: false })
  const [tally, setTally] = useState<Record<string, number>>({})
  const [keep, setKeep] = useState(false)
  const { current, play, stop } = usePlayer()
  const setEngine = usePrefs((s) => s.setEngine)
  const setVoice = usePrefs((s) => s.setVoice)

  const pool = candidates.filter((c) => c.language === language)
  const chosen = picked.map((k) => candidates.find((c) => c.key === k)).filter(Boolean) as Candidate[]

  useEffect(() => {
    setPicked([])
    setText(SAMPLES[language]?.[0] ?? '')
  }, [language])

  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length >= 5 ? p : [...p, key]))

  const cleanup = (all: Record<string, Take>) => {
    const ids = Object.values(all).map((t) => t.id)
    if (ids.length && !keep) void voxd.deleteTakes(ids).catch(() => {})
  }

  const start = async () => {
    setPhase('rendering')
    setRenderDone(0)
    setTally({})
    const rendered: Record<string, Take> = {}
    try {
      for (const c of chosen) {
        rendered[c.key] = await voxd.speak({ text, voice: c.voice, engine: c.engine, speed: 1 })
        setRenderDone((n) => n + 1)
      }
    } catch (e) {
      toast.error('Couldn’t render a voice', { description: (e as Error).message })
      cleanup(rendered)
      setPhase('setup')
      return
    }
    setTakes(rendered)
    const all: [Candidate, Candidate][] = []
    chosen.forEach((a, i) => chosen.slice(i + 1).forEach((b) => all.push(Math.random() < 0.5 ? [a, b] : [b, a])))
    setPairs(shuffle(all).slice(0, MAX_PAIRS))
    setRound(0)
    setHeard({ a: false, b: false })
    setPhase('rating')
  }

  const pair = pairs[round]
  const listen = (side: 'a' | 'b') => {
    const c = side === 'a' ? pair[0] : pair[1]
    const t = takes[c.key]
    const id = `cmp-${side}-${round}`
    if (current === id) return stop()
    setHeard((h) => ({ ...h, [side]: true }))
    void play(id, voxd.audioUrl(t))
  }

  const choose = async (winner: 'a' | 'b' | 'tie') => {
    if (!pair) return
    stop()
    const [a, b] = pair
    void voxd.rate({ language, text, a: { engine: a.engine, voice: a.voice }, b: { engine: b.engine, voice: b.voice }, winner }).catch(() => {})
    setTally((t) => {
      const next = { ...t }
      if (winner === 'tie') {
        next[a.key] = (next[a.key] ?? 0) + 0.5
        next[b.key] = (next[b.key] ?? 0) + 0.5
      } else {
        const w = winner === 'a' ? a : b
        next[w.key] = (next[w.key] ?? 0) + 1
      }
      return next
    })
    if (round + 1 >= pairs.length) setPhase('results')
    else {
      setRound(round + 1)
      setHeard({ a: false, b: false })
    }
  }

  // Keyboard while rating: 1 / 2 listen, ← A, → B, T tie.
  useEffect(() => {
    if (phase !== 'rating') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      const ready = heard.a && heard.b
      if (e.key === '1') listen('a')
      else if (e.key === '2') listen('b')
      else if (e.key === 'ArrowLeft' && ready) void choose('a')
      else if (e.key === 'ArrowRight' && ready) void choose('b')
      else if (e.key.toLowerCase() === 't' && ready) void choose('tie')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const ranking = [...chosen].sort((x, y) => (tally[y.key] ?? 0) - (tally[x.key] ?? 0))
  const finish = () => {
    cleanup(takes)
    setTakes({})
    setPhase('setup')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <header>
        <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Compare</h2>
        <p className="text-[14px] text-text-2">A blind taste test for voices. Listen without names, pick the better one, and find the voice you really prefer.</p>
      </header>

      {phase === 'setup' && (
        <div className="grid gap-5 md:grid-cols-[1fr_20rem]">
          <GlassPanel className="space-y-5 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-text-3">Language</span>
              {(languages.length ? languages : ['en']).map((l) => (
                <button key={l} type="button" onClick={() => setLanguage(l)} className={cn('rounded-full px-3 py-1 text-[12px] transition-colors', l === language ? 'bg-accent text-white' : 'bg-fill-control hover:bg-fill-hover')}>
                  {LANGUAGES[l]}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-text-3">What they’ll read</span>
                <Button size="sm" variant="ghost" onClick={() => setText(shuffle(SAMPLES[language] ?? [text])[0])}>
                  <Shuffle size={11} /> Another sample
                </Button>
              </div>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={400} aria-label="Sentence" className="w-full resize-none rounded-[var(--radius-md)] bg-fill-control p-3 text-[14px] leading-relaxed outline-none" />
              <p className="text-[11px] text-text-3">Tip: use a line like the ones you’ll actually produce — names, numbers and emotion reveal differences quickly.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-semibold text-text-3">Voices to compare</span>
                <span className="text-[11px] text-text-3">{picked.length}/5 · pick 2–5</span>
              </div>
              <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                {pool.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={picked.includes(c.key)}
                    onClick={() => toggle(c.key)}
                    className={cn('rounded-[9px] px-2.5 py-1.5 text-left text-[12px] transition-all', picked.includes(c.key) ? 'bg-accent text-white shadow-[0_3px_10px_color-mix(in_srgb,var(--accent)_35%,transparent)]' : 'bg-fill-control hover:bg-fill-hover')}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className={cn('ml-1.5 text-[10px]', picked.includes(c.key) ? 'text-white/70' : 'text-text-3')}>{ENGINE_LABEL[c.engine]}</span>
                  </button>
                ))}
                {!pool.length && <p className="text-[12px] text-text-3">No voices for this language yet — download Kokoro from Models.</p>}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="primary" disabled={chosen.length < 2 || !text.trim()} onClick={() => void start()}>
                <Scale size={13} /> Start blind test
              </Button>
              <span className="text-[11px] text-text-3">
                {chosen.length >= 2 ? `${Math.min(MAX_PAIRS, (chosen.length * (chosen.length - 1)) / 2)} rounds · names hidden until the end` : 'Pick at least two voices'}
              </span>
            </div>
          </GlassPanel>
          <GlassPanel className="space-y-3 p-5">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Trophy size={14} className="text-[#ffcc00]" /> Your favourites in {LANGUAGES[language] ?? language}
            </h3>
            <Leaderboard language={language} names={names} />
          </GlassPanel>
        </div>
      )}

      {phase === 'rendering' && (
        <GlassPanel className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Loader2 size={24} className="animate-spin text-accent" />
          <div className="text-[14px] font-medium">Preparing the voices… {renderDone}/{chosen.length}</div>
          <div className="h-1.5 w-64 overflow-hidden rounded-full bg-fill-control">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(renderDone / Math.max(1, chosen.length)) * 100}%` }} />
          </div>
        </GlassPanel>
      )}

      {phase === 'rating' && pair && (
        <GlassPanel className="space-y-6 p-8">
          <div className="flex items-center justify-between text-[12px] text-text-3">
            <span>
              Round {round + 1} of {pairs.length}
            </span>
            <div className="flex gap-1">
              {pairs.map((_, i) => (
                <span key={i} className={cn('h-1.5 w-6 rounded-full', i < round ? 'bg-accent' : i === round ? 'bg-accent/50' : 'bg-fill-control')} />
              ))}
            </div>
          </div>
          <p className="text-center text-[15px] leading-relaxed text-text-2 italic">“{text}”</p>
          <div className="grid grid-cols-2 gap-5">
            {(['a', 'b'] as const).map((side, i) => {
              const id = `cmp-${side}-${round}`
              const on = current === id
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => listen(side)}
                  className={cn('group relative flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border-[0.5px] p-8 transition-all', on ? 'border-accent bg-accent/10' : 'border-hairline bg-fill-control hover:bg-fill-hover')}
                >
                  <span className="font-[var(--font-display)] text-[44px] font-bold tracking-[-0.03em]">{side.toUpperCase()}</span>
                  <span className={cn('grid size-12 place-items-center rounded-full text-white transition-transform group-active:scale-95', on ? 'bg-accent' : 'bg-text-1/80')}>
                    {on ? <Square size={16} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                  </span>
                  <span className="text-[11px] text-text-3">
                    {heard[side] ? 'Heard' : 'Listen'} · <Kbd>{i + 1}</Kbd>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" disabled={!heard.a || !heard.b} onClick={() => void choose('a')}>
              ← A sounds better
            </Button>
            <Button disabled={!heard.a || !heard.b} onClick={() => void choose('tie')}>
              About the same <Kbd>T</Kbd>
            </Button>
            <Button variant="primary" disabled={!heard.a || !heard.b} onClick={() => void choose('b')}>
              B sounds better →
            </Button>
          </div>
          {!(heard.a && heard.b) && <p className="text-center text-[11px] text-text-3">Listen to both first.</p>}
        </GlassPanel>
      )}

      {phase === 'results' && (
        <GlassPanel className="space-y-6 p-8">
          <div className="flex flex-col items-center gap-2 text-center animate-[pop-in_400ms_var(--ease-spring)_both]">
            <Crown size={30} className="text-[#ffcc00]" />
            <div className="text-[12px] font-semibold tracking-wide text-text-3 uppercase">Your pick</div>
            <div className="font-[var(--font-display)] text-[30px] font-bold tracking-[-0.02em]">{ranking[0]?.name}</div>
            <div className="text-[12px] text-text-3">{ENGINE_LABEL[ranking[0]?.engine]} voice</div>
            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  const w = ranking[0]
                  setEngine(w.engine)
                  setVoice(w.engine, w.voice)
                  toast.success(`${w.name} is now your quick voice`)
                }}
              >
                <Sparkles size={12} /> Use as my quick voice
              </Button>
              <Button onClick={finish}>
                <RotateCcw size={12} /> Compare again
              </Button>
            </div>
          </div>
          <ol className="mx-auto max-w-md space-y-2">
            {ranking.map((c, i) => (
              <li key={c.key} className="flex items-center gap-3 rounded-[var(--radius-md)] bg-fill-control px-3 py-2">
                <span className="w-5 text-center text-[13px] font-bold text-text-3">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</span>
                <button type="button" onClick={() => void play(`res-${c.key}`, voxd.audioUrl(takes[c.key]))} className="text-text-3 hover:text-text-1" aria-label={`Play ${c.name}`}>
                  <Play size={13} />
                </button>
                <span className="w-16 text-right text-[12px] tabular-nums text-text-3">{tally[c.key] ?? 0} pts</span>
              </li>
            ))}
          </ol>
          <label className="mx-auto flex max-w-md items-center justify-between text-[12px] text-text-3">
            Keep these recordings in History
            <Switch label="Keep recordings" checked={keep} onChange={setKeep} />
          </label>
        </GlassPanel>
      )}
    </div>
  )
}
