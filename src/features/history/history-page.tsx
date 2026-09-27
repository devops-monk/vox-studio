import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CheckSquare, Download, History as HistoryIcon, Loader2, Pause, Play, Search, Square, Star, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, SegmentedControl } from '@/components/glass'
import { Waveform } from '@/components/waveform'
import { VoiceAvatar } from '@/components/voice-avatar'
import { usePlayer } from '@/lib/audio/player'
import { saveTake } from '@/lib/save'
import { voiceLabel } from '@/lib/voice-label'
import { formatBytes } from '@/lib/format'
import { voxd } from '@/lib/voxd/client'
import { useCustomVoices, useDeleteTakes, useDesignedVoices, useHistory, useStarTake, useTakeStats, type HistoryFilter } from '@/lib/voxd/queries'
import type { Take } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'

const ENGINE: Record<string, string> = { system: 'System', kokoro: 'Kokoro', chatterbox: 'Chatterbox' }

function dayLabel(unix: number) {
  const d = new Date(unix * 1000)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(today) - start(d)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

interface RowProps {
  take: Take
  name: string
  selecting: boolean
  selected: boolean
  onToggle: () => void
  onDelete: () => void
}

function Row({ take, name, selecting, selected, onToggle, onDelete }: RowProps) {
  const { current, play, stop } = usePlayer()
  const star = useStarTake()
  const playing = current === take.id
  const url = voxd.audioUrl(take)
  return (
    <li
      className={cn('group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill-hover', selected && 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]')}
      onClick={selecting ? onToggle : undefined}
    >
      {selecting ? (
        <span className="text-[var(--accent)]">{selected ? <CheckSquare size={16} /> : <Square size={16} className="text-text-3" />}</span>
      ) : (
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => (playing ? stop() : void play(take.id, url))}
          className={cn('flex size-7 shrink-0 items-center justify-center rounded-full transition-colors', playing ? 'bg-[var(--accent)] text-white' : 'bg-fill-control text-text-1 hover:bg-fill-active')}
        >
          {playing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-px" />}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]" title={take.text}>
          {take.text}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-text-3">
          <VoiceAvatar id={take.voice} name={name} size={14} />
          <span className="truncate">
            {name} · {ENGINE[take.engine] ?? take.engine} · {new Date(take.created_at * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      </div>
      <Waveform id={take.id} url={url} duration={take.duration_s} bars={40} className="hidden h-6 w-40 shrink-0 md:flex" />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-text-3">{take.duration_s.toFixed(1)}s</span>
      {!selecting && (
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            aria-label={take.starred ? 'Unstar' : 'Star'}
            aria-pressed={take.starred}
            onClick={() => star.mutate({ id: take.id, starred: !take.starred })}
            className={cn(take.starred ? 'text-[#ffcc00] hover:text-[#ffcc00]' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          >
            <Star size={13} fill={take.starred ? 'currentColor' : 'none'} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Save as…" onClick={() => void saveTake(take)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
            <Download size={13} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete" onClick={onDelete} className="opacity-0 hover:text-[#ff453a] group-hover:opacity-100 focus-visible:opacity-100">
            <Trash2 size={13} />
          </Button>
        </div>
      )}
    </li>
  )
}

export function HistoryPage() {
  const [query, setQuery] = useState('')
  const [show, setShow] = useState<'all' | 'starred'>('all')
  const [engine, setEngine] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const q = useDebounced(query.trim(), 250)
  const filter: HistoryFilter = { q: q || undefined, starred: show === 'starred' ? true : undefined, engine: engine || undefined }
  const history = useHistory(filter)
  const stats = useTakeStats().data
  const custom = useCustomVoices().data ?? []
  const designed = useDesignedVoices().data ?? []
  const remove = useDeleteTakes()
  const sentinel = useRef<HTMLDivElement>(null)

  const takes = useMemo(() => history.data?.pages.flat() ?? [], [history.data])
  const groups = useMemo(() => {
    const out: [string, Take[]][] = []
    for (const t of takes) {
      const label = dayLabel(t.created_at)
      const last = out[out.length - 1]
      if (last?.[0] === label) last[1].push(t)
      else out.push([label, [t]])
    }
    return out
  }, [takes])

  // Load the next page when the bottom scrolls into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [history])

  const deleteIds = (ids: string[]) =>
    remove.mutate(ids, {
      onSuccess: ({ deleted }) => {
        toast(`${deleted.length} take${deleted.length === 1 ? '' : 's'} deleted`)
        setSelected(new Set())
        setSelecting(false)
      },
      onError: (e) => toast.error(e.message),
    })

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const filtered = !!(q || show === 'starred' || engine)

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-8 py-8">
      <header className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">History</h2>
          {stats && (
            <p className="text-[13px] text-text-2">
              {stats.count} takes · {stats.starred} starred · {formatBytes(stats.bytes)}
            </p>
          )}
        </div>
        <Button onClick={() => (setSelecting((v) => !v), setSelected(new Set()))} disabled={!takes.length}>
          {selecting ? 'Done' : 'Select'}
        </Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex h-7 w-72 items-center gap-2 rounded-[8px] bg-fill-control px-2.5 text-text-3">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search what was said" className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-3" />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </label>
        <SegmentedControl
          aria-label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'starred', label: 'Starred' },
          ]}
        />
        <select value={engine} onChange={(e) => setEngine(e.target.value)} aria-label="Engine" className="h-7 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] outline-none">
          <option value="">All engines</option>
          {Object.entries(ENGINE).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-20">
        {history.isLoading ? (
          <div className="glass h-64 animate-pulse rounded-[var(--radius-lg)]" />
        ) : groups.length ? (
          <div className="space-y-5">
            {groups.map(([label, list]) => (
              <section key={label}>
                <h3 className="mb-1.5 px-1 text-[12px] font-semibold tracking-wide text-text-3">{label}</h3>
                <ul className="glass divide-y-[0.5px] divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-lg)]">
                  {list.map((t) => (
                    <Row
                      key={t.id}
                      take={t}
                      name={voiceLabel(t, custom, designed)}
                      selecting={selecting}
                      selected={selected.has(t.id)}
                      onToggle={() => toggle(t.id)}
                      onDelete={() => deleteIds([t.id])}
                    />
                  ))}
                </ul>
              </section>
            ))}
            <div ref={sentinel} className="flex justify-center py-3">
              {history.isFetchingNextPage && <Loader2 size={16} className="animate-spin text-text-3" />}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <HistoryIcon size={28} strokeWidth={1.4} className="text-text-3" />
            <div className="text-[14px] font-medium text-text-2">{filtered ? 'No takes match' : 'Nothing here yet'}</div>
            <div className="text-[12px] text-text-3">{filtered ? 'Try a different search or filter.' : 'Everything you generate is kept here.'}</div>
            {!filtered && (
              <Link to="/studio" className="mt-2">
                <Button variant="primary">Open Studio</Button>
              </Link>
            )}
          </div>
        )}
      </div>

      {selecting && (
        <div className="glass-pop fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full py-2 pl-5 pr-2 animate-[pop-in_200ms_var(--ease-spring)]">
          <span className="text-[13px] font-medium tabular-nums">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(takes.map((t) => t.id)))}>
            Select all
          </Button>
          <Button
            size="sm"
            variant="primary"
            className="bg-[#ff453a]"
            disabled={!selected.size || remove.isPending}
            onClick={() => deleteIds([...selected])}
          >
            <Trash2 size={12} /> Delete
          </Button>
        </div>
      )}
    </div>
  )
}
