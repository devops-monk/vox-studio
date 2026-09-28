import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash } from 'lucide-react'
import { Button } from '@/components/glass'
import { useTags } from '@/lib/voxd/queries'
import { TagEditor } from '@/features/voices/tag-editor'
import { cn } from '@/lib/cn'

/** Small read-only tag chips. */
export function TagChips({ tags, onPick, className }: { tags: string[]; onPick?: (tag: string) => void; className?: string }) {
  if (!tags.length) return null
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {tags.map((t) => (
        <button
          key={t}
          type="button"
          disabled={!onPick}
          onClick={(e) => (e.stopPropagation(), onPick?.(t))}
          className="rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1.5 py-px text-[10px] font-medium text-accent enabled:hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
        >
          #{t}
        </button>
      ))}
    </span>
  )
}

/** A “#” button that opens a tag editor in a popover (rendered in a portal so cards can't clip it). */
export function TagButton({ tags, onChange, label = 'Tags', className }: { tags: string[]; onChange: (tags: string[]) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const suggestions = (useTags().data ?? []).map((t) => t.tag)

  useEffect(() => {
    if (!open) return
    const r = anchor.current!.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - 300, r.right - 280)) })
    const close = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => (window.removeEventListener('mousedown', close), window.removeEventListener('keydown', esc))
  }, [open])

  return (
    <>
      <span ref={anchor} className="inline-flex">
        <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))} className={cn(tags.length && 'text-accent', className)}>
          <Hash size={13} />
        </Button>
      </span>
      {open &&
        pos &&
        createPortal(
          <div ref={panel} style={pos} className="glass-pop fixed z-50 w-72 space-y-2 rounded-[var(--radius-lg)] p-3 animate-[pop-in_180ms_var(--ease-spring)_both]" onClick={(e) => e.stopPropagation()}>
            <div className="text-[11px] font-semibold tracking-wide text-text-3">Tags · also shown in Collections</div>
            <TagEditor tags={tags} suggestions={suggestions} onChange={onChange} />
          </div>,
          document.body,
        )}
    </>
  )
}
