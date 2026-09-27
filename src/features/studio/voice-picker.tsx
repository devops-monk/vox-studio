import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Mic, Search } from 'lucide-react'
import { VoiceAvatar } from '@/components/voice-avatar'
import { useLibrary, useVoices } from '@/lib/voxd/queries'
import type { Voice } from '@/lib/voxd/types'
import { languageName } from '@/lib/format'
import { cn } from '@/lib/cn'

const GENDER: Record<string, string> = { female: 'Female', male: 'Male' }

interface Props {
  engine: string
  value: string
  onChange: (voice: string) => void
  cloning: boolean
}

export function VoicePicker({ engine, value, onChange, cloning }: Props) {
  const voices = useVoices(engine).data ?? []
  const library = useLibrary().data
  const [query, setQuery] = useState('')

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (v: Voice) => !q || v.name.toLowerCase().includes(q) || languageName(v.language).toLowerCase().includes(q)
    const favorite = new Set((library ?? []).filter((v) => v.favorite && (v.custom || v.engine === engine)).map((v) => v.id))
    const favs = voices.filter((v) => favorite.has(v.id) && match(v))
    const own = (v: Voice) => v.id.startsWith('cv_') || v.id.startsWith('dv_')
    const mine = voices.filter((v) => own(v) && !favorite.has(v.id) && match(v))
    const rest = voices.filter((v) => !own(v) && !favorite.has(v.id) && match(v))
    const byLang = new Map<string, Voice[]>()
    for (const v of rest) byLang.set(v.language, [...(byLang.get(v.language) ?? []), v])
    const userLang = navigator.language.split('-')[0]
    const langs = [...byLang.entries()].sort(([a], [b]) => {
      const rank = (t: string) => (t === navigator.language ? 0 : t.startsWith(userLang) ? 1 : 2)
      return rank(a) - rank(b) || languageName(a).localeCompare(languageName(b))
    })
    return [
      ...(favs.length ? [['Favorites', favs] as const] : []),
      ...(mine.length ? [['Your voices', mine] as const] : []),
      ...langs.map(([l, list]) => [languageName(l), list] as const),
    ]
  }, [voices, query, library, engine])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {voices.length > 8 && (
        <label className="flex h-7 items-center gap-2 rounded-[8px] bg-fill-control px-2.5 text-text-3">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search voices or languages"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-3"
          />
        </label>
      )}
      <div role="listbox" aria-label="Voices" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {cloning && !voices.some((v) => v.id.startsWith('cv_')) && (
          <Link
            to="/clone"
            className="mb-2 flex items-center gap-3 rounded-[10px] border border-dashed border-[var(--hairline-strong)] p-3 text-[12px] text-text-2 hover:bg-fill-hover"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">
              <Mic size={14} />
            </span>
            <span>
              <span className="block font-medium text-text-1">Clone your voice</span>
              Record 10 seconds and speak in it.
            </span>
          </Link>
        )}
        {sections.map(([title, list]) => (
          <div key={title} className="mb-2">
            <div className="sticky top-0 z-10 bg-[var(--glass-3)] px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-3 backdrop-blur">
              {title}
            </div>
            {list.map((v) => {
              const selected = v.id === value
              return (
                <button
                  key={v.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onChange(v.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 text-left transition-colors',
                    selected ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'hover:bg-fill-hover',
                  )}
                >
                  <VoiceAvatar id={v.id} name={v.name} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{v.name}</span>
                    <span className="block truncate text-[11px] text-text-3">
                      {[languageName(v.language), v.gender && GENDER[v.gender]].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {selected && <Check size={14} className="shrink-0 text-[var(--accent)]" />}
                </button>
              )
            })}
          </div>
        ))}
        {!sections.length && <p className="px-2 py-6 text-center text-[12px] text-text-3">No voices match “{query}”.</p>}
      </div>
    </div>
  )
}
