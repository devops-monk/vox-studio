import { useState } from 'react'
import { Plus, X } from 'lucide-react'

interface Props {
  tags: string[]
  suggestions: string[]
  onChange: (tags: string[]) => void
}

export function TagEditor({ tags, suggestions, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const add = (t: string) => {
    const tag = t.trim().toLowerCase().slice(0, 24)
    if (tag && !tags.includes(tag) && tags.length < 12) onChange([...tags, tag])
    setDraft('')
  }
  const unused = suggestions.filter((s) => !tags.includes(s) && s.includes(draft.trim().toLowerCase())).slice(0, 6)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] py-0.5 pl-2.5 pr-1 text-[12px] text-[var(--accent)]">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="rounded-full p-0.5 hover:bg-[var(--accent)]/20">
              <X size={11} />
            </button>
          </span>
        ))}
        <label className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-[var(--hairline-strong)] px-2 text-text-3 focus-within:border-[var(--accent)]">
          <Plus size={11} />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                add(draft)
              }
              if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
            }}
            placeholder="Add tag"
            aria-label="Add tag"
            className="w-20 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-3"
          />
        </label>
      </div>
      {draft && unused.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unused.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full bg-fill-control px-2 py-0.5 text-[11px] text-text-2 hover:bg-fill-hover">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
