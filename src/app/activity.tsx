import { create } from 'zustand'
import { useEffect, useRef } from 'react'
import { AlertCircle, Ban, Check, Inbox, ListChecks, Loader2, Pause, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { usePlayer } from '@/lib/audio/player'
import { voxd } from '@/lib/voxd/client'
import { useCancelJob, useClearJobs, useJobs } from '@/lib/voxd/queries'
import { isActive, type Job, type SpeechJobResult } from '@/lib/voxd/types'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/cn'

/** Circular progress around the toolbar icon while anything is running. */
function Ring({ value }: { value: number }) {
  const r = 12
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 28 28" className="pointer-events-none absolute inset-0 -rotate-90" aria-hidden>
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--hairline-strong)" strokeWidth="2" />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.04, value))}
        className="transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  )
}

function StatusIcon({ job }: { job: Job }) {
  const base = 'flex size-7 shrink-0 items-center justify-center rounded-full'
  switch (job.status) {
    case 'running':
      return <span className={cn(base, 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]')}><Loader2 size={14} className="animate-spin" /></span>
    case 'queued':
      return <span className={cn(base, 'bg-fill-control text-text-3')}><ListChecks size={14} /></span>
    case 'succeeded':
      return <span className={cn(base, 'bg-[#30d158]/15 text-[#30d158]')}><Check size={14} strokeWidth={2.5} /></span>
    case 'failed':
      return <span className={cn(base, 'bg-[#ff453a]/15 text-[#ff453a]')}><AlertCircle size={14} /></span>
    default:
      return <span className={cn(base, 'bg-fill-control text-text-3')}><Ban size={13} /></span>
  }
}

function JobRow({ job }: { job: Job }) {
  const cancel = useCancelJob()
  const { current, play, stop } = usePlayer()
  const result = job.status === 'succeeded' && job.kind === 'speech' ? (job.result as unknown as SpeechJobResult | null) : null
  const playing = !!result && current === result.take_id
  const sub =
    job.status === 'failed' ? job.error : job.status === 'running' || job.status === 'queued' ? job.message : `${job.message ?? job.status} · ${timeAgo(job.updated_at)}`

  return (
    <li className="group flex gap-3 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-fill-hover">
      <StatusIcon job={job} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{job.title}</div>
        <div className={cn('truncate text-[11px]', job.status === 'failed' ? 'text-[#ff453a]' : 'text-text-3')} title={sub ?? undefined}>
          {sub}
        </div>
        {job.status === 'running' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-fill-control">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(3, job.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex items-center">
        {isActive(job) && (
          <Button variant="ghost" size="icon" aria-label="Cancel" onClick={() => cancel.mutate(job.id)} className="opacity-60 group-hover:opacity-100">
            <X size={14} />
          </Button>
        )}
        {result && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={playing ? 'Stop' : 'Play'}
            onClick={() => (playing ? stop() : void play(result.take_id, voxd.audioUrl(result)))}
          >
            {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          </Button>
        )}
      </div>
    </li>
  )
}

/** Toolbar button + popover listing every background job. */
/** Open state is shared so the menu bar (View → Show Activity) can open the popover. */
export const useActivityPanel = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

export function Activity() {
  const { open, setOpen } = useActivityPanel()
  const jobs = useJobs().data ?? []
  const clear = useClearJobs()
  const root = useRef<HTMLDivElement>(null)

  const active = jobs.filter(isActive)
  const running = active.find((j) => j.status === 'running')
  const hasFinished = jobs.some((j) => !isActive(j))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useJobToasts(jobs)

  return (
    <div ref={root} className="no-drag relative">
      <button
        type="button"
        aria-label={active.length ? `Activity, ${active.length} running` : 'Activity'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'relative flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-text-2 transition-colors hover:bg-fill-hover hover:text-text-1',
          open && 'bg-fill-active text-text-1',
        )}
      >
        {running && <Ring value={running.progress} />}
        <ListChecks size={15} strokeWidth={1.8} className={cn(active.length && 'text-[var(--accent)]')} />
        {active.length > 1 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold text-white">
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div className="glass-pop absolute right-0 top-9 z-40 w-[360px] origin-top-right overflow-hidden rounded-[var(--radius-lg)] animate-[pop-in_180ms_var(--ease-spring)]">
          <div className="flex items-center justify-between border-b-[0.5px] border-hairline px-4 py-2.5">
            <div className="text-[13px] font-semibold">Activity</div>
            {hasFinished && (
              <Button variant="ghost" size="sm" onClick={() => clear.mutate()}>
                Clear finished
              </Button>
            )}
          </div>
          {jobs.length ? (
            <ul className="max-h-[420px] overflow-y-auto p-1.5">
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <Inbox size={26} strokeWidth={1.4} className="text-text-3" />
              <div className="text-[13px] font-medium text-text-2">Nothing running</div>
              <div className="text-[12px] text-text-3">Long renders, downloads and dubs show up here.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Announce jobs that finish while the user is elsewhere. */
function useJobToasts(jobs: Job[]) {
  const seen = useRef(new Map<string, string>())
  useEffect(() => {
    for (const job of jobs) {
      const before = seen.current.get(job.id)
      seen.current.set(job.id, job.status)
      if (!before || before === job.status || !['queued', 'running'].includes(before)) continue
      if (job.status === 'succeeded') {
        if (job.kind === 'model.download') {
          toast.success(`${job.title.replace(/^Downloading /, '')} is installed`, { description: 'Its voices are ready to use.' })
          continue
        }
        const result = job.kind === 'speech' ? (job.result as unknown as SpeechJobResult | null) : null
        toast.success(job.title, {
          description: result ? `Ready · ${result.duration_s.toFixed(1)}s` : 'Finished',
          action: result ? { label: 'Play', onClick: () => void usePlayer.getState().play(result.take_id, voxd.audioUrl(result)) } : undefined,
        })
      } else if (job.status === 'failed') {
        toast.error(job.title, { description: job.error ?? 'Failed' })
      }
    }
  }, [jobs])
}
