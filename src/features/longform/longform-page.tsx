import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Download, FileUp, Loader2, Pause, Play, SkipBack, SkipForward, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, SegmentedControl, Slider } from '@/components/glass'
import { playbackPosition, usePlayer } from '@/lib/audio/player'
import { isTauri } from '@/lib/platform'
import { timeAgo } from '@/lib/time'
import { voxd } from '@/lib/voxd/client'
import { useBook, useBooks, useChapterTimings, useEngines, useJob, useVoices } from '@/lib/voxd/queries'
import type { Book, BookSummary, Chapter, Timing } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { DownloadBar } from '@/features/models/model-parts'

type Kind = 'story' | 'audiobook'
const COPY: Record<Kind, { title: string; lead: string; noun: string }> = {
  story: { title: 'Stories', lead: 'Multi-voice stories: a narrator plus a voice for every character.', noun: 'story' },
  audiobook: { title: 'Audiobooks', lead: 'Turn books into chaptered audiobooks, narrated on your computer.', noun: 'book' },
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17)

// ------------------------------------------------------------------ library

function Cover({ book, size = 'md' }: { book: Pick<BookSummary, 'id' | 'title' | 'author'>; size?: 'md' | 'sm' }) {
  const h = hue(book.id)
  return (
    <div
      className={cn('relative flex flex-col justify-between overflow-hidden rounded-[8px] p-3 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25),0_0.5px_0_rgba(255,255,255,0.3)_inset]', size === 'md' ? 'aspect-[2/3] w-full' : 'h-24 w-16 p-1.5')}
      style={{ background: `linear-gradient(160deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 60% 24%))` }}
    >
      <div className="absolute inset-y-0 left-0 w-[6%] bg-black/20" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_55%)]" />
      <div className={cn('relative font-serif font-semibold leading-tight', size === 'md' ? 'text-[17px]' : 'text-[9px]')} style={{ fontFamily: 'ui-serif, "New York", Georgia, serif' }}>
        {book.title}
      </div>
      {size === 'md' && book.author && <div className="relative text-[11px] opacity-80">{book.author}</div>}
    </div>
  )
}

function ImportCard({ kind, onImported }: { kind: Kind; onImported: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const run = async (payload: { file?: File; text?: string }) => {
    setBusy(true)
    try {
      const book = await voxd.importBook({ ...payload, kind })
      toast.success(`Imported “${book.title}”`, { description: `${book.chapters.length} chapter${book.chapters.length === 1 ? '' : 's'}${book.characters.length ? ` · ${book.characters.length} characters` : ''}` })
      onImported(book.id)
    } catch (e) {
      toast.error('Couldn’t import', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (pasting) {
    return (
      <GlassPanel className="col-span-2 flex flex-col gap-3 p-4">
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'Paste your text. Lines like “Chapter 2” start a new chapter.'} className="min-h-40 flex-1 resize-none rounded-[8px] bg-[var(--glass-3)] p-3 text-[13px] outline-none" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPasting(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!text.trim() || busy} onClick={() => void run({ text })}>
            {busy && <Loader2 size={13} className="animate-spin" />} Import text
          </Button>
        </div>
      </GlassPanel>
    )
  }

  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) void run({ file: f })
      }}
      className={cn('flex aspect-[2/3] flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed p-4 text-center transition-colors', dragging ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--hairline-strong)]')}
    >
      {busy ? <Loader2 size={24} className="animate-spin text-text-3" /> : <FileUp size={24} strokeWidth={1.5} className="text-text-3" />}
      <span className="text-[13px] font-medium">Import a {COPY[kind].noun}</span>
      <span className="text-[11px] text-text-3">EPUB, DOCX, TXT or Markdown</span>
      <div className="mt-1 flex flex-col gap-1.5">
        <Button size="sm" variant="primary" onClick={() => input.current?.click()} disabled={busy}>
          Choose file
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPasting(true)} disabled={busy}>
          Paste text
        </Button>
      </div>
      <input ref={input} type="file" accept=".epub,.docx,.txt,.md,.markdown" hidden onChange={(e) => (e.target.files?.[0] && void run({ file: e.target.files[0] }), (e.target.value = ''))} />
    </div>
  )
}

function Library({ kind, onOpen }: { kind: Kind; onOpen: (id: string) => void }) {
  const books = useBooks(kind).data ?? []
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <header>
        <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">{COPY[kind].title}</h2>
        <p className="text-[14px] text-text-2">{COPY[kind].lead}</p>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
        <ImportCard kind={kind} onImported={onOpen} />
        {books.map((b, i) => (
          <button key={b.id} type="button" onClick={() => onOpen(b.id)} className="group space-y-2 text-left animate-[pop-in_300ms_var(--ease-spring)_both]" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="transition-transform duration-200 ease-[var(--ease-spring)] group-hover:-translate-y-1">
              <Cover book={b} />
            </div>
            <div className="space-y-1">
              <div className="truncate text-[13px] font-medium">{b.title}</div>
              <div className="h-1 overflow-hidden rounded-full bg-fill-control">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(b.rendered / Math.max(1, b.chapters)) * 100}%` }} />
              </div>
              <div className="text-[11px] text-text-3">
                {b.rendered}/{b.chapters} chapter{b.chapters === 1 ? '' : 's'} · {b.words.toLocaleString()} words · {timeAgo(b.updated_at)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ voices

function VoicePick({ value, onChange, lang, allowNone }: { value: { engine: string; voice: string } | null; onChange: (v: { engine: string; voice: string } | null) => void; lang: string; allowNone?: string }) {
  const engines = (useEngines().data ?? []).filter((e) => e.available && e.capabilities.includes('tts'))
  const [engine, setEngine] = useState(value?.engine ?? engines.find((e) => e.id === 'kokoro')?.id ?? 'system')
  useEffect(() => {
    if (value?.engine) setEngine(value.engine)
  }, [value?.engine])
  const voices = (useVoices(engine).data ?? []).filter((v) => v.id.startsWith('cv_') || v.id.startsWith('dv_') || v.id === 'default' ? lang === 'en' : v.language.split('-')[0] === lang)
  return (
    <div className="flex gap-1.5">
      <select aria-label="Engine" value={engine} onChange={(e) => setEngine(e.target.value)} className="h-7 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-1.5 text-[12px] outline-none">
        {engines.map((e) => (
          <option key={e.id} value={e.id}>
            {e.id === 'system' ? 'System' : e.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Voice"
        value={value?.engine === engine ? value.voice : ''}
        onChange={(e) => onChange(e.target.value ? { engine, voice: e.target.value } : null)}
        className="h-7 min-w-0 flex-1 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-1.5 text-[12px] outline-none"
      >
        {allowNone ? <option value="">{allowNone}</option> : <option value="" disabled>Choose…</option>}
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

// ------------------------------------------------------------------ reader

const SPEAKER_TINTS = ['#0a84ff', '#ff375f', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ffd60a', '#ac8e68']

function Reader({ chapter, timings, activeIndex, speakers, onSeek }: { chapter: Chapter; timings: Timing[] | null; activeIndex: number; speakers: string[]; onSeek: (t: number) => void }) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    container.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex])

  const paragraphs = useMemo(() => {
    const text = chapter.text
    // Split into paragraphs keeping absolute offsets, then cut each into timed sentence spans.
    const out: { from: number; to: number }[] = []
    let at = 0
    for (const p of text.split('\n\n')) {
      const from = text.indexOf(p, at)
      out.push({ from, to: from + p.length })
      at = from + p.length
    }
    return out
  }, [chapter.text])

  const tint = (speaker: string | null) => (speaker ? SPEAKER_TINTS[Math.max(0, speakers.indexOf(speaker)) % SPEAKER_TINTS.length] : undefined)

  return (
    <div ref={container} className="mx-auto max-w-[62ch] space-y-5 font-serif text-[17px] leading-[1.75] text-text-1" style={{ fontFamily: 'ui-serif, "New York", Georgia, serif' }}>
      {paragraphs.map((p, pi) => {
        const inside = (timings ?? []).map((t, i) => ({ ...t, i })).filter((t) => t.from >= p.from && t.to <= p.to).sort((a, b) => a.from - b.from)
        if (!inside.length) return <p key={pi}>{chapter.text.slice(p.from, p.to)}</p>
        const pieces: React.ReactNode[] = []
        let cursor = p.from
        for (const t of inside) {
          if (t.from > cursor) pieces.push(chapter.text.slice(cursor, t.from))
          const active = t.i === activeIndex
          pieces.push(
            <span
              key={t.i}
              data-active={active}
              onClick={() => onSeek(t.start)}
              className={cn('cursor-pointer rounded-[4px] transition-colors duration-200', active ? 'bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]' : 'hover:bg-fill-hover')}
              style={t.speaker ? { color: tint(t.speaker), textDecoration: active ? undefined : 'none' } : undefined}
            >
              {chapter.text.slice(t.from, t.to)}
            </span>,
          )
          cursor = t.to
        }
        if (cursor < p.to) pieces.push(chapter.text.slice(cursor, p.to))
        return <p key={pi}>{pieces}</p>
      })}
    </div>
  )
}

// ------------------------------------------------------------------ book

async function exportBook(book: Book, format: 'm4b' | 'mp3') {
  if (!book.exports[format]) {
    try {
      await voxd.exportBook(book.id, format)
      toast(`Exporting ${format.toUpperCase()}… it will appear when ready`)
    } catch (e) {
      toast.error('Couldn’t export', { description: (e as Error).message })
    }
    return
  }
  if (!isTauri) {
    const a = document.createElement('a')
    a.href = voxd.mediaUrl(book.exports[format])
    a.click()
    return
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: `${book.title}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
  if (path) await voxd.saveBook(book.id, format, path).then(() => toast.success('Saved'), (e: Error) => toast.error(e.message))
}

function BookView({ id, kind, onBack }: { id: string; kind: Kind; onBack: () => void }) {
  const book = useBook(id).data
  const job = useJob(book?.job_id ?? null).data
  const [chapterId, setChapterId] = useState<string | null>(null)
  const chapter = book?.chapters.find((c) => c.id === chapterId) ?? book?.chapters[0]
  const rendered = chapter?.status === 'rendered' || chapter?.status === 'stale'
  const timings = useChapterTimings(id, chapter?.id ?? null, !!chapter?.audio_url).data
  const { current, play, stop, seek } = usePlayer()
  const key = chapter ? `book-${id}-${chapter.id}` : ''
  const playing = current === key
  const [time, setTime] = useState(0)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      setTime(playbackPosition().time)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  if (!book || !chapter) return <div className="p-8"><GlassPanel className="h-96 animate-pulse" /></div>

  const list = (timings?.timings ?? []) as unknown as Timing[]
  const activeIndex = playing ? list.findIndex((t) => time >= t.start && time < t.end) : -1
  const speakers = book.characters.map((c) => c.name as string)
  const idx = book.chapters.findIndex((c) => c.id === chapter.id)
  const busy = !!book.job_id
  const renderedCount = book.chapters.filter((c) => c.status === 'rendered').length
  const allRendered = book.chapters.every((c) => c.status !== 'not_rendered')

  const playFrom = async (t = 0) => {
    if (!chapter.audio_url) return
    if (!playing) await play(key, voxd.mediaUrl(chapter.audio_url))
    seek(t)
  }
  const patch = (body: Parameters<typeof voxd.patchBook>[1]) => void voxd.patchBook(book.id, body).catch((e: Error) => toast.error(e.message))
  const render = (chapters?: string[]) => void voxd.renderBook(book.id, chapters).catch((e: Error) => toast.error('Couldn’t start', { description: e.message }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b-[0.5px] border-hairline px-6 py-4">
        <Button variant="ghost" size="icon" aria-label="Back to library" onClick={onBack}>
          <ArrowLeft size={15} />
        </Button>
        <Cover book={book} size="sm" />
        <div className="min-w-0 flex-1">
          <input
            defaultValue={book.title}
            key={book.title}
            onBlur={(e) => e.target.value.trim() && e.target.value !== book.title && patch({ title: e.target.value.trim() })}
            aria-label="Title"
            className="w-full rounded-[6px] bg-transparent font-[var(--font-display)] text-[20px] font-semibold tracking-[-0.01em] outline-none hover:bg-fill-hover focus:bg-fill-control"
          />
          <div className="text-[12px] text-text-3">
            {book.author ? `${book.author} · ` : ''}
            {book.chapters.length} chapter{book.chapters.length === 1 ? '' : 's'} · {renderedCount} narrated
          </div>
        </div>
        <SegmentedControl
          aria-label="Narration"
          value={book.kind as Kind}
          onChange={(k) => patch({ kind: k })}
          options={[
            { value: 'audiobook', label: 'One narrator' },
            { value: 'story', label: 'Character voices' },
          ]}
        />
        <Button variant="primary" disabled={busy} onClick={() => render()}>
          <Wand2 size={13} /> {renderedCount === book.chapters.length ? 'Up to date' : renderedCount ? 'Narrate the rest' : 'Narrate book'}
        </Button>
        <Button disabled={!allRendered || busy} onClick={() => void exportBook(book, 'm4b')} title="Audiobook with chapters">
          <Download size={12} /> {book.exports.m4b ? 'Save M4B' : 'M4B'}
        </Button>
        <Button variant="ghost" disabled={!allRendered || busy} onClick={() => void exportBook(book, 'mp3')}>
          {book.exports.mp3 ? 'Save MP3' : 'MP3'}
        </Button>
      </div>

      {busy && (
        <div className="flex items-center gap-4 border-b-[0.5px] border-hairline px-6 py-3">
          <div className="flex-1">
            <DownloadBar progress={job?.progress ?? 0} message={job?.message ?? 'Starting…'} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => void voxd.cancelJob(book.job_id!)}>
            Pause
          </Button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_260px]">
        <nav aria-label="Chapters" className="min-h-0 overflow-y-auto border-r-[0.5px] border-hairline p-2">
          {book.chapters.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => (setChapterId(c.id), stop())}
              className={cn('flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[13px] transition-colors', c.id === chapter.id ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'hover:bg-fill-hover')}
            >
              <span
                className={cn('size-2 shrink-0 rounded-full', c.status === 'rendered' ? 'bg-[#30d158]' : c.status === 'stale' ? 'bg-[#ff9f0a]' : 'bg-[var(--hairline-strong)]')}
                title={c.status === 'rendered' ? 'Narrated' : c.status === 'stale' ? 'Changed since narration' : 'Not narrated yet'}
              />
              <span className="min-w-0 flex-1 truncate">
                {i + 1}. {c.title}
              </span>
              {c.duration_s != null && <span className="shrink-0 text-[10px] tabular-nums text-text-3">{clock(c.duration_s)}</span>}
            </button>
          ))}
        </nav>

        <div className="min-h-0 overflow-y-auto px-10 py-8">
          <h3 className="mx-auto mb-6 max-w-[62ch] font-[var(--font-display)] text-[24px] font-bold tracking-[-0.02em]">{chapter.title}</h3>
          <Reader chapter={chapter} timings={list} activeIndex={activeIndex} speakers={speakers} onSeek={(t) => void playFrom(t)} />
          {!rendered && (
            <div className="mx-auto mt-8 flex max-w-[62ch] items-center justify-between rounded-[var(--radius-md)] bg-fill-control p-3 text-[12px] text-text-2">
              This chapter hasn’t been narrated yet.
              <Button size="sm" onClick={() => render([chapter.id])} disabled={busy}>
                <Sparkles size={12} /> Narrate this chapter
              </Button>
            </div>
          )}
        </div>

        <aside className="min-h-0 space-y-5 overflow-y-auto border-l-[0.5px] border-hairline p-4">
          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Narrator</h4>
            <VoicePick lang={book.language} value={(book.cast as { narrator?: { engine: string; voice: string } }).narrator ?? null} onChange={(v) => v && patch({ cast: { narrator: v } })} />
          </section>
          {kind === 'story' || book.kind === 'story' ? (
            <section className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Characters</h4>
              {book.characters.length ? (
                book.characters.map((c, i) => {
                  const cast = (book.cast as { characters?: Record<string, { engine: string; voice: string } | null> }).characters ?? {}
                  return (
                    <div key={c.name as string} className="space-y-1">
                      <div className="flex items-center gap-2 text-[12px] font-medium">
                        <span className="size-2 rounded-full" style={{ background: SPEAKER_TINTS[i % SPEAKER_TINTS.length] }} />
                        {c.name as string}
                        <span className="text-text-3">
                          · {c.lines as number} line{(c.lines as number) === 1 ? '' : 's'}
                        </span>
                      </div>
                      <VoicePick lang={book.language} allowNone="Narrator’s voice" value={cast[c.name as string] ?? null} onChange={(v) => patch({ cast: { characters: { [c.name as string]: v } } })} />
                    </div>
                  )
                })
              ) : (
                <p className="text-[12px] text-text-3">No speaking characters found. Dialogue like “Hello,” said Ann. is detected automatically.</p>
              )}
            </section>
          ) : null}
          <section className="space-y-2">
            <Slider label="Pace" value={book.speed} min={0.7} max={1.4} step={0.05} onChange={(v) => patch({ speed: Math.round(v * 100) / 100 })} format={(v) => `${v.toFixed(2)}×`} ends={['Slower', 'Faster']} />
          </section>
          <div className="pt-4">
            <Button
              variant="ghost"
              size="sm"
              onBlur={() => setConfirm(false)}
              onClick={() => (confirm ? void voxd.deleteBook(book.id).then(() => (toast('Deleted'), onBack())) : setConfirm(true))}
              className={cn(confirm && 'bg-[#ff453a]/12 text-[#ff453a]')}
            >
              <Trash2 size={12} /> {confirm ? 'Confirm delete' : `Delete ${COPY[kind].noun}`}
            </Button>
          </div>
        </aside>
      </div>

      <div className="flex items-center gap-3 border-t-[0.5px] border-hairline bg-[var(--glass-1)] px-6 py-3">
        <Button variant="ghost" size="icon" aria-label="Previous chapter" disabled={idx <= 0} onClick={() => (setChapterId(book.chapters[idx - 1].id), stop())}>
          <SkipBack size={14} />
        </Button>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={!chapter.audio_url}
          onClick={() => (playing ? stop() : void playFrom(0))}
          className="flex size-9 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_4px_14px_color-mix(in_srgb,var(--accent)_45%,transparent)] disabled:opacity-40"
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>
        <Button variant="ghost" size="icon" aria-label="Next chapter" disabled={idx >= book.chapters.length - 1} onClick={() => (setChapterId(book.chapters[idx + 1].id), stop())}>
          <SkipForward size={14} />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium">{chapter.title}</div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-fill-control">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${playing && chapter.duration_s ? (time / chapter.duration_s) * 100 : 0}%` }} />
          </div>
        </div>
        <span className="text-[11px] tabular-nums text-text-3">
          {playing ? clock(time) : '0:00'} / {chapter.duration_s ? clock(chapter.duration_s) : '–'}
        </span>
      </div>
    </div>
  )
}

export function LongformPage({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState<string | null>(null)
  if (open) return <BookView key={open} id={open} kind={kind} onBack={() => setOpen(null)} />
  return <Library kind={kind} onOpen={setOpen} />
}

export const StoriesPage = () => <LongformPage kind="story" />
export const AudiobookPage = () => <LongformPage kind="audiobook" />
