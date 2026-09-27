import { useEffect, useState } from 'react'
import { Check, Download, Loader2, Play, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { usePlayer } from '@/lib/audio/player'
import { voxd } from '@/lib/voxd/client'
import { useCancelJob, useDeleteModel, useDownloadModel, useJob } from '@/lib/voxd/queries'
import type { Model } from '@/lib/voxd/types'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'

/** Deterministic gradient artwork per model, so each one has its own identity. */
export function ModelArt({ model, size = 64 }: { model: Model; size?: number }) {
  const hue = [...model.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <div
      aria-hidden
      className="relative shrink-0 overflow-hidden shadow-[0_0.5px_0_rgba(255,255,255,0.4)_inset,0_6px_20px_rgba(0,0,0,0.18)]"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        background: `linear-gradient(135deg, hsl(${hue} 85% 62%), hsl(${(hue + 50) % 360} 80% 50%) 55%, hsl(${(hue + 110) % 360} 70% 42%))`,
      }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.35),transparent_55%)]" />
      <div className="absolute inset-0 flex items-center justify-center gap-[3px]">
        {[0.35, 0.65, 1, 0.55, 0.8, 0.4].map((h, i) => (
          <span key={i} className="w-[3px] rounded-full bg-white/90" style={{ height: size * 0.5 * h }} />
        ))}
      </div>
    </div>
  )
}

const FIT = {
  great: { label: 'Great fit', dot: 'bg-[#30d158]' },
  ok: { label: 'Will run', dot: 'bg-[#ffd60a]' },
  no: { label: 'Not supported', dot: 'bg-[#ff453a]' },
} as const

export function FitBadge({ model }: { model: Model }) {
  const fit = FIT[model.fit.level as keyof typeof FIT] ?? FIT.ok
  return (
    <span title={model.fit.reason} className="inline-flex items-center gap-1.5 rounded-full bg-fill-control px-2 py-0.5 text-[11px] font-medium text-text-2">
      <span className={cn('size-1.5 rounded-full', fit.dot)} />
      {fit.label}
    </span>
  )
}

export function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-fill-control px-2 py-0.5 text-[11px] font-medium text-text-2">{children}</span>
}

/** Live download progress for a model (0–1), or null when not downloading. */
export function useDownloadProgress(model: Model) {
  const job = useJob(model.status === 'downloading' ? model.job_id ?? null : null).data
  if (model.status !== 'downloading') return null
  return { progress: job?.progress ?? 0, message: job?.message ?? 'Starting download…', jobId: model.job_id! }
}

export function DownloadBar({ progress, message }: { progress: number; message: string }) {
  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-[11px] text-text-3">
        <span>{message}</span>
        <span className="tabular-nums">{Math.round(progress * 100)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-fill-control">
        <div
          className="relative h-full overflow-hidden rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, progress * 100)}%` }}
        >
          <div className="absolute inset-0 animate-[shimmer_1.6s_linear_infinite] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)]" />
        </div>
      </div>
    </div>
  )
}

const PREVIEW_TEXT = 'Hi! This is how I sound. Everything you hear is generated right here on your computer.'

/** Download / progress / installed actions for one model. */
export function ModelActions({ model, previewVoice }: { model: Model; previewVoice?: string }) {
  const download = useDownloadModel()
  const cancel = useCancelJob()
  const remove = useDeleteModel()
  const play = usePlayer((s) => s.play)
  const [confirming, setConfirming] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const dl = useDownloadProgress(model)

  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 3500)
    return () => clearTimeout(t)
  }, [confirming])

  if (dl) {
    return (
      <div className="flex w-full items-center gap-3">
        <DownloadBar progress={dl.progress} message={dl.message} />
        <Button variant="ghost" size="icon" aria-label="Cancel download" onClick={() => cancel.mutate(dl.jobId)}>
          <X size={14} />
        </Button>
      </div>
    )
  }

  if (model.status === 'installed') {
    const preview = async () => {
      if (!previewVoice) return
      setPreviewing(true)
      try {
        const take = await voxd.speak({ text: PREVIEW_TEXT, voice: previewVoice, engine: model.engine, speed: 1 })
        await play(take.id, voxd.audioUrl(take))
      } catch (e) {
        toast.error('Preview failed', { description: (e as Error).message })
      } finally {
        setPreviewing(false)
      }
    }
    return (
      <div className="flex items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1 text-[12px] font-medium text-[#30d158]">
          <Check size={14} strokeWidth={2.5} /> Installed
        </span>
        {previewVoice && (
          <Button size="sm" onClick={() => void preview()} disabled={previewing}>
            {previewing ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} fill="currentColor" />} Try
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => (confirming ? remove.mutate(model.id, { onSuccess: () => toast(`${model.name} removed`) }) : setConfirming(true))}
          className={cn(confirming && 'bg-[#ff453a]/12 text-[#ff453a] hover:bg-[#ff453a]/20 hover:text-[#ff453a]')}
        >
          <Trash2 size={12} /> {confirming ? `Remove ${formatBytes(model.size_bytes + model.runtime_bytes)}?` : 'Remove'}
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="primary"
      disabled={model.fit.level === 'no' || download.isPending}
      onClick={() => download.mutate(model.id, { onError: (e) => toast.error('Download failed', { description: e.message }) })}
    >
      <Download size={14} /> Download · {formatBytes(model.size_bytes + model.runtime_bytes)}
    </Button>
  )
}
