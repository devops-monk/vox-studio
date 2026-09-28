import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronsLeft, ChevronsRight, CircleHelp, Pause, Quote, Sparkle, Timer } from 'lucide-react'
import { Switch } from '@/components/glass'
import { voxd } from '@/lib/voxd/client'
import type { components } from '@/lib/voxd/schema'
import { cn } from '@/lib/cn'

type Preview = components['schemas']['MarkupOut']

// Mirrors voxd/markup.py. Used only for highlighting; voxd does the real parsing.
const TOKENS = /(\[pause(?:\s+\d+(?:\.\d+)?\s*(?:ms|s)?)?\]|\[\/?(?:slow|fast|speed(?:\s+\d+(?:\.\d+)?)?)\]|\*[^*\n]+\*|\{[^{}|\n]+\|[^{}\n]+\})/gi
export const HAS_MARKUP = /\[\/?(?:pause|slow|fast|speed)[^\]]*\]|\*[^*\n]+\*|\{[^{}|\n]+\|[^{}\n]+\}/i

function tint(token: string) {
  const t = token.toLowerCase()
  if (t.startsWith('[pause')) return 'bg-[#ff9f0a]/22 text-transparent rounded-[4px]'
  if (t.startsWith('[')) return 'bg-[#0a84ff]/20 rounded-[4px]'
  if (t.startsWith('*')) return 'bg-[#bf5af2]/20 rounded-[4px]'
  return 'bg-[#30d158]/20 rounded-[4px]'
}

/** Highlighted copy of the script drawn behind the (transparent-background) textarea. */
function Backdrop({ text }: { text: string }) {
  const parts = text.split(TOKENS)
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i} className={cn('text-transparent', tint(p))}>{p}</mark> : <span key={i}>{p}</span>))}
      {'\n'}
    </>
  )
}

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  markup: boolean
  onMarkup: (on: boolean) => void
  speed: number
  onEstimate: (seconds: number | null) => void
}

export function MarkupEditor({ value, onChange, onSubmit, placeholder, markup, onMarkup, speed, onEstimate }: Props) {
  const area = useRef<HTMLTextAreaElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sayAs, setSayAs] = useState<{ start: number; end: number; word: string } | null>(null)
  const [spoken, setSpoken] = useState('')
  const [help, setHelp] = useState(false)
  const active = markup && HAS_MARKUP.test(value)

  // Live preview of how the script will be performed.
  useEffect(() => {
    if (!active) {
      setPreview(null)
      onEstimate(null)
      return
    }
    const t = setTimeout(() => {
      voxd.markupPreview(value, speed).then(
        (p) => (setPreview(p), onEstimate(p.estimated_s)),
        () => setPreview(null),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [value, speed, active, onEstimate])

  const syncScroll = () => {
    if (back.current && area.current) back.current.scrollTop = area.current.scrollTop
  }
  useLayoutEffect(syncScroll, [value])

  const edit = (build: (sel: string) => string, cursorAtEnd = true) => {
    const el = area.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const insert = build(value.slice(a, b))
    const next = value.slice(0, a) + insert + value.slice(b)
    onChange(next)
    if (!markup) onMarkup(true)
    requestAnimationFrame(() => {
      el.focus()
      const pos = cursorAtEnd ? a + insert.length : a
      el.setSelectionRange(pos, pos)
    })
  }

  const wrap = (open: string, close: string) => edit((sel) => `${open}${sel || 'text'}${close}`)
  const startSayAs = () => {
    const el = area.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const word = value.slice(a, b).trim()
    if (!word) return
    setSayAs({ start: a, end: b, word })
    setSpoken('')
  }
  const finishSayAs = () => {
    if (!sayAs || !spoken.trim()) return setSayAs(null)
    onChange(value.slice(0, sayAs.start) + `{${sayAs.word}|${spoken.trim()}}` + value.slice(sayAs.end))
    if (!markup) onMarkup(true)
    setSayAs(null)
  }

  const tools: { label: string; icon: typeof Pause; hint: string; run: () => void }[] = [
    {
      label: 'Pause',
      icon: Timer,
      hint: 'Insert a pause — [pause 0.5s]',
      run: () => {
        const a = area.current?.selectionStart ?? value.length
        const before = a > 0 && !/\s/.test(value[a - 1]) ? ' ' : ''
        const after = a < value.length && !/\s/.test(value[a]) ? ' ' : ''
        edit(() => `${before}[pause 0.5s]${after}`)
      },
    },
    { label: 'Slower', icon: ChevronsLeft, hint: 'Slow down the selection — [slow]…[/slow]', run: () => wrap('[slow]', '[/slow]') },
    { label: 'Faster', icon: ChevronsRight, hint: 'Speed up the selection — [fast]…[/fast]', run: () => wrap('[fast]', '[/fast]') },
    { label: 'Emphasis', icon: Sparkle, hint: 'Stress the selection — *word*', run: () => wrap('*', '*') },
    { label: 'Say as…', icon: Quote, hint: 'Pronounce the selection differently — {written|spoken}', run: startSayAs },
  ]

  const text = 'px-6 py-5 font-[var(--font-display)] text-[17px] leading-[1.7] whitespace-pre-wrap break-words'

  return (
    <div>
      <div className="flex min-w-0 items-center gap-1 border-b-[0.5px] border-hairline py-1.5 pr-4 pl-3">
        {tools.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.hint}
            onMouseDown={(e) => e.preventDefault()} // keep the textarea selection
            onClick={t.run}
            className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] text-text-2 transition-colors hover:bg-fill-hover hover:text-text-1"
          >
            <t.icon size={12} /> {t.label}
          </button>
        ))}
        <div className="relative ml-auto flex shrink-0 items-center gap-2 pr-1">
          <button type="button" aria-label="Markup help" onClick={() => setHelp((h) => !h)} className="text-text-3 hover:text-text-1">
            <CircleHelp size={14} />
          </button>
          <span className="text-[11px] text-text-3">Markup</span>
          <Switch label="Script markup" checked={markup} onChange={onMarkup} />
          {help && (
            <div className="glass-pop absolute top-full right-0 z-30 mt-2 w-80 space-y-1.5 rounded-[var(--radius-lg)] p-4 text-[12px] animate-[pop-in_200ms_var(--ease-spring)_both]">
              {[
                ['[pause 1s]', 'A pause (0.5 s by default; ms works too)'],
                ['[slow]…[/slow]', 'Slower (0.8×); [fast] is 1.2×'],
                ['[speed 1.3]…[/speed]', 'Any speed from 0.5× to 2×'],
                ['*word*', 'Emphasis'],
                ['{SQL|sequel}', 'Show one thing, say another'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <code className="w-36 shrink-0 font-[var(--font-mono)] text-[11px] text-accent">{k}</code>
                  <span className="text-text-2">{v}</span>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-text-3">Select text, then use the buttons above. Takes keep the clean text.</p>
            </div>
          )}
        </div>
      </div>
      {sayAs && (
        <div className="flex items-center gap-2 border-b-[0.5px] border-hairline bg-[#30d158]/8 px-4 py-2 text-[12px] animate-[pop-in_200ms_var(--ease-spring)_both]">
          <span className="text-text-2">
            Say “<b>{sayAs.word}</b>” as
          </span>
          <input
            autoFocus
            value={spoken}
            onChange={(e) => setSpoken(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' ? finishSayAs() : e.key === 'Escape' && setSayAs(null))}
            placeholder="how it sounds, e.g. sequel"
            aria-label="Spoken form"
            className="h-7 min-w-0 flex-1 rounded-[6px] bg-fill-control px-2 outline-none"
          />
          <button type="button" onClick={finishSayAs} className="rounded-[6px] bg-accent px-2.5 py-1 font-medium text-white">
            Apply
          </button>
        </div>
      )}
      <div className="relative">
        {markup && (
          <div ref={back} aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden text-transparent', text)}>
            <Backdrop text={value} />
          </div>
        )}
        <textarea
          ref={area}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder={placeholder}
          aria-label="Script"
          spellCheck
          className={cn('relative block min-h-[300px] w-full resize-y bg-transparent text-text-1 outline-none placeholder:text-text-3', text)}
        />
      </div>
      {preview && (
        <div className="flex max-h-28 flex-wrap items-center gap-1 overflow-y-auto border-t-[0.5px] border-hairline px-4 py-2.5" aria-label="Performance preview">
          <span className="mr-1 text-[10px] font-semibold tracking-wide text-text-3 uppercase">Performance</span>
          {preview.segments.map((s, i) =>
            s.kind === 'pause' ? (
              <span key={i} className="flex items-center gap-0.5 rounded-full bg-[#ff9f0a]/15 px-2 py-0.5 text-[11px] font-medium text-[#ff9f0a]">
                <Pause size={9} fill="currentColor" /> {s.seconds}s
              </span>
            ) : (
              <span
                key={i}
                title={s.text ?? ''}
                className={cn('max-w-56 truncate rounded-full px-2 py-0.5 text-[11px]', s.emphasis ? 'bg-[#bf5af2]/15 font-semibold text-[#bf5af2]' : s.speed !== 1 ? 'bg-[#0a84ff]/12 text-[#0a84ff]' : 'bg-fill-control text-text-2')}
              >
                {s.speed !== 1 && `${s.speed}× `}
                {s.text}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  )
}
