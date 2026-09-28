import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FolderPlus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { voxd } from '@/lib/voxd/client'
import { useMembership, useProjects } from '@/lib/voxd/queries'
import type { ProjectKind } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'

export const PROJECT_COLORS = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#ac8e68']

/** A small popover to add the current item to one or more projects. */
export function AddToProject({ kind, id, compact }: { kind: ProjectKind; id: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const projects = useProjects().data ?? []
  const member = new Set(useMembership(kind, id, open).data ?? [])
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  // Rendered in a portal so cards with their own stacking context can't cover it.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = root.current?.getBoundingClientRect()
      if (!r) return
      const below = r.bottom + 6
      const height = 260
      setPos({ top: below + height > window.innerHeight ? Math.max(8, r.top - height - 6) : below, right: window.innerWidth - r.right })
    }
    place()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const toggle = (projectId: string) =>
    (member.has(projectId) ? voxd.removeFromProject(projectId, kind, id) : voxd.addToProject(projectId, kind, id)).catch((e: Error) => toast.error(e.message))

  const create = async () => {
    if (!name.trim()) return
    try {
      const p = await voxd.createProject(name.trim(), PROJECT_COLORS[projects.length % PROJECT_COLORS.length])
      await voxd.addToProject(p.id, kind, id)
      toast.success(`Added to ${p.name}`)
      setName('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div ref={root} className="relative">
      {compact ? (
        <Button variant="ghost" size="icon" aria-label="Add to project" onClick={() => setOpen((v) => !v)} className={cn(member.size > 0 && 'text-[var(--accent)]')}>
          <FolderPlus size={14} />
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          <FolderPlus size={12} /> Project
        </Button>
      )}
      {open && pos && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="Add to project"
          style={{ top: pos.top, right: pos.right }}
          className="glass-pop fixed z-50 max-h-64 w-60 overflow-y-auto rounded-[var(--radius-md)] p-1.5 animate-[pop-in_160ms_var(--ease-spring)]"
        >
          <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-3">Add to project</div>
          {projects.map((p) => (
            <button key={p.id} type="button" onClick={() => void toggle(p.id)} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[13px] hover:bg-fill-hover">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {member.has(p.id) && <Check size={13} className="text-[var(--accent)]" />}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
            className="mt-1 flex items-center gap-1.5 border-t-[0.5px] border-hairline px-1 pt-1.5"
          >
            <Plus size={12} className="shrink-0 text-text-3" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project…" className="min-w-0 flex-1 bg-transparent py-1 text-[12px] outline-none placeholder:text-text-3" />
          </form>
        </div>,
        document.body,
      )}
    </div>
  )
}
