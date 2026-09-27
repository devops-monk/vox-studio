import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { usePlayer } from '@/lib/audio/player'
import { voxd } from './client'
import { useCancelJob, useEngines, useJob, useSpeak, useSpeakLong } from './queries'
import type { SpeechJobResult, SpeechRequest } from './types'

/** Above this, text renders as a background job with progress instead of a single request. */
export const LONG_TEXT = 600

/**
 * Generate speech and play it when ready. Slow engines (voice cloning) and long text run as
 * background jobs so there's progress and a Cancel; quick ones return in a single request.
 */
export function useSpeechRunner() {
  const engines = useEngines().data ?? []
  const speak = useSpeak()
  const speakLong = useSpeakLong()
  const cancelJob = useCancelJob()
  const play = usePlayer((s) => s.play)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId).data

  useEffect(() => {
    if (!job || job.id !== jobId || job.status === 'queued' || job.status === 'running') return
    setJobId(null)
    const result = job.result as unknown as SpeechJobResult | null
    if (job.status === 'succeeded' && result) void play(result.take_id, voxd.audioUrl(result))
    else if (job.status === 'failed') toast.error('Couldn’t generate speech', { description: job.error ?? undefined })
  }, [job, jobId, play])

  const generate = async (request: SpeechRequest & { title?: string }) => {
    const slow = engines.find((e) => e.id === request.engine)?.capabilities.includes('clone')
    try {
      if (slow || request.text.length > LONG_TEXT) {
        setJobId((await speakLong.mutateAsync(request)).id)
      } else {
        const take = await speak.mutateAsync(request)
        await play(take.id, voxd.audioUrl(take))
      }
    } catch (e) {
      toast.error('Couldn’t generate speech', { description: (e as Error).message })
    }
  }

  const busy = speak.isPending || speakLong.isPending || !!jobId
  const status = jobId
    ? job?.status === 'running'
      ? `Rendering ${Math.round(job.progress * 100)}%`
      : job?.status === 'queued'
        ? 'Queued…'
        : 'Starting…'
    : speak.isPending
      ? 'Generating…'
      : null

  return { generate, busy, status, jobId, progress: job?.progress ?? 0, cancel: () => jobId && cancelJob.mutate(jobId) }
}
