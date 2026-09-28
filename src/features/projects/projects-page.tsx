import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, AudioLines, BookOpen, ExternalLink, FileText, Film, FolderKanban, FolderOpen, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel } from '@/components/glass'
import { PROJECT_COLORS } from '@/components/add-to-project'
import { usePlayer } from '@/lib/audio/player'
import { formatBytes } from '@/lib/format'
import { revealInFinder } from '@/lib/reveal'
import { useFocus } from '@/lib/store/focus'
import { timeAgo } from '@/lib/time'
import { voxd } from '@/lib/voxd/client'
import { useExportHistory, useProject, useProjects } from '@/lib/voxd/queries'
import type { ExportRecord } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { TagButton, TagChips } from '@/components/tags'

const KIND = {
  take: { icon: AudioLines, label: 'Takes' },
  transcript: { icon: FileText, label: 'Transcripts' },
  dub: { icon: Film, label: 'Dubs' },
  book: { icon: BookOpen, label: 'Stories & audiobooks' },
} as const
type Kind = keyof typeof KIND

function ExportList({ exports }: { exports: ExportRecord[] }) {
  if (!exports.length) return <p className="px-1 text-[12px] text-text-3">Nothing exported yet. Files you save from VoxStudio are listed here.</p>
  return (
    <ul className="glass divide-y-[0.5px] divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-lg)]">
      {exports.map((e) => (
        <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className="w-10 shrink-0 rounded-[5px] bg-fill-control py-0.5 text-center text-[10px] font-bold uppercase text-text-2">{e.format}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]" title={e.path}>
              {e.path.split(/[\\/]/).pop()}
            </div>
            <div className="truncate text-[11px] text-text-3">
              {e.title} · {formatBytes(e.bytes)} · {timeAgo(e.at)}
              {!e.exists && ' · moved or deleted'}
            </div>
          </div>
          <Button size="sm" variant="ghost" disabled={!e.exists} onClick={() => void revealInFinder(e.path)}>
            <FolderOpen size={12} /> Show in Finder
          </Button>
        </li>
      ))}
    </ul>
  )
}

function ProjectView({ id, onBack }: { id: string; onBack: () => void }) {
  const project = useProject(id).data
  const navigate = useNavigate()
  const focus = useFocus((s) => s.open)
  const play = usePlayer((s) => s.play)
  const [confirm, setConfirm] = useState(false)
  if (!project) return <div className="p-8"><GlassPanel className="h-64 animate-pulse" /></div>

  const groups = (Object.keys(KIND) as Kind[]).map((k) => [k, project.items.filter((i) => i.kind === k)] as const).filter(([, list]) => list.length)

  const open = (kind: Kind, itemId: string) => {
    if (kind === 'take') return void play(itemId, voxd.mediaUrl(`/v1/takes/${itemId}/audio`))
    focus(kind, itemId)
    void navigate({ to: kind === 'dub' ? '/dub' : kind === 'transcript' ? '/transcribe' : '/stories' })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="All projects" onClick={onBack}>
          <ArrowLeft size={15} />
        </Button>
        <span className="size-4 rounded-full" style={{ background: project.color }} />
        <input
          key={project.name}
          defaultValue={project.name}
          aria-label="Project name"
          onBlur={(e) => e.target.value.trim() && e.target.value !== project.name && void voxd.patchProject(id, { name: e.target.value.trim() })}
          className="min-w-0 flex-1 rounded-[6px] bg-transparent font-[var(--font-display)] text-[26px] font-bold tracking-[-0.02em] outline-none hover:bg-fill-hover focus:bg-fill-control"
        />
        <div className="flex gap-1">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => void voxd.patchProject(id, { color: c })}
              aria-pressed={c === project.color}
              className={cn('size-4 rounded-full transition-transform hover:scale-110', c === project.color && 'scale-110 shadow-[0_0_0_2px_var(--glass-1),0_0_0_3.5px_currentColor]')}
              style={{ background: c, color: c }}
            />
          ))}
        </div>
        <TagButton tags={project.tags ?? []} onChange={(tags) => void voxd.tagProject(id, tags).catch((e: Error) => toast.error(e.message))} label="Project tags" />
        <Button
          variant="ghost"
          size="sm"
          onBlur={() => setConfirm(false)}
          onClick={() => (confirm ? void voxd.deleteProject(id).then(() => (toast('Project deleted — its items are kept'), onBack())) : setConfirm(true))}
          className={cn(confirm && 'bg-[#ff453a]/12 text-[#ff453a]')}
        >
          <Trash2 size={12} /> {confirm ? 'Confirm' : 'Delete'}
        </Button>
      </div>

      {!!project.tags?.length && <TagChips tags={project.tags} className="-mt-3" />}
      {groups.length ? (
        groups.map(([kind, list]) => {
          const Icon = KIND[kind].icon
          return (
            <section key={kind} className="space-y-2">
              <h3 className="flex items-center gap-1.5 px-1 text-[12px] font-semibold tracking-wide text-text-3">
                <Icon size={13} /> {KIND[kind].label}
              </h3>
              <ul className="glass divide-y-[0.5px] divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-lg)]">
                {list.map((item) => (
                  <li key={item.id} className={cn('group flex items-center gap-3 px-4 py-2.5', item.missing && 'opacity-50')}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{item.title}</div>
                      <div className="truncate text-[11px] text-text-3">
                        {item.subtitle} · added {timeAgo(item.added_at)}
                      </div>
                    </div>
                    {!item.missing && (
                      <Button size="sm" variant="ghost" onClick={() => open(kind, item.id)}>
                        {kind === 'take' ? 'Play' : 'Open'} <ExternalLink size={11} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove from project"
                      onClick={() => void voxd.removeFromProject(id, kind, item.id)}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X size={13} />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      ) : (
        <GlassPanel className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <FolderKanban size={28} strokeWidth={1.4} className="text-text-3" />
          <div className="text-[14px] font-medium text-text-2">This project is empty</div>
          <div className="max-w-sm text-[12px] text-text-3">Use the folder button on takes, transcripts, dubs and books to add them here.</div>
        </GlassPanel>
      )}

      <section className="space-y-2">
        <h3 className="px-1 text-[12px] font-semibold tracking-wide text-text-3">Exports</h3>
        <ExportList exports={project.exports} />
      </section>
    </div>
  )
}

export function ProjectsPage() {
  const projects = useProjects().data ?? []
  const exports = useExportHistory().data ?? []
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState('')

  if (open) return <ProjectView id={open} onBack={() => setOpen(null)} />

  const create = async () => {
    if (!name.trim()) return
    const p = await voxd.createProject(name.trim(), PROJECT_COLORS[projects.length % PROJECT_COLORS.length]).catch((e: Error) => (toast.error(e.message), null))
    if (p) {
      setName('')
      setOpen(p.id)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-8 py-8">
      <header>
        <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Projects</h2>
        <p className="text-[14px] text-text-2">Group takes, transcripts, dubs and books — and find every file you’ve exported.</p>
      </header>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          className="flex min-h-28 flex-col justify-between rounded-[var(--radius-lg)] border border-dashed border-[var(--hairline-strong)] p-4"
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" aria-label="New project name" className="bg-transparent text-[14px] font-medium outline-none placeholder:text-text-3" />
          <Button type="submit" size="sm" variant="primary" disabled={!name.trim()} className="self-start">
            <Plus size={12} /> Create
          </Button>
        </form>
        {projects.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(p.id)}
            className="relative min-h-28 overflow-hidden rounded-[var(--radius-lg)] p-4 text-left text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-[var(--ease-spring)] animate-[pop-in_300ms_var(--ease-spring)_both] hover:-translate-y-0.5"
            style={{ background: `linear-gradient(145deg, ${p.color}, color-mix(in srgb, ${p.color} 55%, black))`, animationDelay: `${i * 40}ms` }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.3),transparent_60%)]" />
            <div className="relative text-[16px] font-semibold tracking-[-0.01em]">{p.name}</div>
            <div className="relative mt-6 text-[12px] opacity-85">
              {p.item_count} item{p.item_count === 1 ? '' : 's'} · {timeAgo(p.updated_at)}
            </div>
            {!!p.tags?.length && <div className="relative mt-1 truncate text-[11px] opacity-80">{p.tags.map((t) => `#${t}`).join(' ')}</div>}
          </button>
        ))}
      </div>

      <section className="space-y-2">
        <h3 className="px-1 text-[12px] font-semibold tracking-wide text-text-3">All exports</h3>
        <ExportList exports={exports} />
      </section>
    </div>
  )
}
