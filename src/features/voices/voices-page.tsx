import { useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Import, Library, Loader2, Mic, Pause, Play, Search, Star } from 'lucide-react'
import { Button, SegmentedControl } from '@/components/glass'
import { VoiceAvatar } from '@/components/voice-avatar'
import { useLibrary, useVoiceMeta } from '@/lib/voxd/queries'
import type { LibraryVoice } from '@/lib/voxd/types'
import { languageName } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ImportDialog } from './import-dialog'
import { usePreview } from './use-preview'
import { VoiceDetail } from './voice-detail'

type Filter = 'all' | 'favorites' | 'yours' | 'builtin'
const ENGINE: Record<string, string> = { system: 'System', kokoro: 'Kokoro', chatterbox: 'Chatterbox' }
const keyOf = (v: LibraryVoice) => `${v.engine}:${v.id}`
/** Neural voices first; OS voices last. */
const ENGINE_RANK: Record<string, number> = { chatterbox: 0, kokoro: 1, system: 9 }

function VoiceCard({ voice, selected, onOpen }: { voice: LibraryVoice; selected: boolean; onOpen: () => void }) {
  const meta = useVoiceMeta()
  const preview = usePreview()
  const playing = preview.playing(voice)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      aria-pressed={selected}
      className={cn(
        'glass group relative flex cursor-pointer flex-col gap-3 rounded-[var(--radius-lg)] p-4 text-left transition-all duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5',
        selected && 'shadow-[0_0_0_2px_var(--accent),var(--shadow-card)]',
        !voice.available && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <VoiceAvatar id={voice.id} name={voice.name} size={44} />
          <button
            type="button"
            aria-label={playing ? `Stop ${voice.name}` : `Preview ${voice.name}`}
            disabled={!voice.available && !voice.custom}
            onClick={(e) => {
              e.stopPropagation()
              void preview.toggle(voice)
            }}
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white transition-opacity',
              playing || preview.loading(voice) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            {preview.loading(voice) ? <Loader2 size={16} className="animate-spin" /> : playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{voice.name}</div>
          <div className="truncate text-[11px] text-text-3">
            {[languageName(voice.language), voice.gender && (voice.gender === 'female' ? 'Female' : 'Male')].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          type="button"
          aria-label={voice.favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={voice.favorite}
          onClick={(e) => {
            e.stopPropagation()
            meta.mutate({ engine: voice.engine, voice: voice.id, favorite: !voice.favorite })
          }}
          className={cn(
            'rounded-full p-1 transition-all',
            voice.favorite ? 'text-[#ffcc00]' : 'text-text-3 opacity-0 hover:text-text-1 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Star size={15} fill={voice.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
 <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', voice.custom || voice.designed ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]' : 'bg-fill-control text-text-2')}>
          {voice.custom ? 'Your voice' : voice.designed ? 'Designed' : ENGINE[voice.engine] ?? voice.engine}
        </span>
        {voice.tags.slice(0, 3).map((t) => (
          <span key={t} className="rounded-full bg-fill-control px-2 py-0.5 text-[10px] text-text-2">
            {t}
          </span>
        ))}
        {voice.tags.length > 3 && <span className="text-[10px] text-text-3">+{voice.tags.length - 3}</span>}
      </div>
    </div>
  )
}

export function VoicesPage() {
  const library = useLibrary()
  const voices = library.data ?? []
  const [filter, setFilter] = useState<Filter>('all')
  const [engine, setEngine] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [importing, setImporting] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const allTags = useMemo(() => [...new Set(voices.flatMap((v) => v.tags))].sort(), [voices])
  const engines = useMemo(() => [...new Set(voices.filter((v) => !v.custom).map((v) => v.engine))], [voices])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return voices
      .filter((v) => (filter === 'favorites' ? v.favorite : filter === 'yours' ? v.custom || v.designed : filter === 'builtin' ? !v.custom && !v.designed : true))
      .filter((v) => engine === 'all' || v.custom || v.engine === engine)
      .filter((v) => !tag || v.tags.includes(tag))
      .filter((v) => !q || v.name.toLowerCase().includes(q) || languageName(v.language).toLowerCase().includes(q) || v.tags.some((t) => t.includes(q)))
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          Number(b.custom || b.designed) - Number(a.custom || a.designed) ||
          (ENGINE_RANK[a.engine] ?? 5) - (ENGINE_RANK[b.engine] ?? 5),
      )
  }, [voices, filter, engine, tag, query])

  const selected = voices.find((v) => keyOf(v) === selectedKey) ?? null
  const counts = { favorites: voices.filter((v) => v.favorite).length, yours: voices.filter((v) => v.custom || v.designed).length }

  return (
    <div className="flex h-full gap-4 p-6">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mb-4 flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Voices</h2>
            <p className="text-[13px] text-text-2">
              {voices.length} voices · {counts.yours} yours · {counts.favorites} favorites
            </p>
          </div>
          <Button onClick={() => fileInput.current?.click()}>
            <Import size={13} /> Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".voxvoice"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setImporting(f)
              e.target.value = ''
            }}
          />
          <Link to="/clone">
            <Button variant="primary">
              <Mic size={13} /> New voice
            </Button>
          </Link>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="flex h-7 w-60 items-center gap-2 rounded-[8px] bg-fill-control px-2.5 text-text-3">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, language or tag" className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-3" />
          </label>
          <SegmentedControl<Filter>
            aria-label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'favorites', label: 'Favorites' },
              { value: 'yours', label: 'Yours' },
              { value: 'builtin', label: 'Built-in' },
            ]}
          />
          {engines.length > 1 && (
            <select value={engine} onChange={(e) => setEngine(e.target.value)} aria-label="Engine" className="h-7 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] outline-none">
              <option value="all">All engines</option>
              {engines.map((e) => (
                <option key={e} value={e}>
                  {ENGINE[e] ?? e}
                </option>
              ))}
            </select>
          )}
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
              className={cn('h-6 rounded-full px-2.5 text-[11px] transition-colors', tag === t ? 'bg-[var(--accent)] text-white' : 'bg-fill-control text-text-2 hover:bg-fill-hover')}
            >
              #{t}
            </button>
          ))}
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-4">
          {library.isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="glass h-[104px] animate-pulse rounded-[var(--radius-lg)]" />
              ))}
            </div>
          ) : shown.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {shown.map((v) => (
                <VoiceCard key={keyOf(v)} voice={v} selected={keyOf(v) === selectedKey} onOpen={() => setSelectedKey(keyOf(v))} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Library size={28} strokeWidth={1.4} className="text-text-3" />
              <div className="text-[14px] font-medium text-text-2">{filter === 'favorites' ? 'No favorites yet' : filter === 'yours' ? 'No voices of your own yet' : 'No voices match'}</div>
              <div className="text-[12px] text-text-3">
                {filter === 'favorites' ? 'Tap ☆ on any voice to keep it here.' : filter === 'yours' ? 'Clone a voice from a short recording.' : 'Try a different search or filter.'}
              </div>
              {filter === 'yours' && (
                <Link to="/clone" className="mt-2">
                  <Button variant="primary">
                    <Mic size={13} /> Clone a voice
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {selected && <VoiceDetail key={selectedKey} voice={selected} allTags={allTags} onClose={() => setSelectedKey(null)} />}
      {importing && <ImportDialog file={importing} onClose={() => setImporting(null)} onImported={(id) => setSelectedKey(`chatterbox:${id}`)} />}
    </div>
  )
}
