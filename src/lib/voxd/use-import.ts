import { useState } from 'react'
import { voxd } from './client'

async function finished(jobId: string, onProgress: (text: string) => void) {
  for (;;) {
    const job = await voxd.job(jobId)
    if (job.status === 'succeeded') return job.result as Record<string, string>
    if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error ?? `The import was ${job.status}`)
    onProgress(job.message ?? 'Downloading…')
    await new Promise((r) => setTimeout(r, 700))
  }
}

/** Import audio/video from a link (voxd downloads it), then dub or transcribe it. */
export function useImportLink() {
  const [status, setStatus] = useState<string | null>(null)
  const run = async (body: Parameters<typeof voxd.importUrl>[0]) => {
    setStatus('Checking the link…')
    try {
      const job = await voxd.importUrl(body)
      return await finished(job.id, setStatus)
    } finally {
      setStatus(null)
    }
  }
  return { run, busy: status !== null, status }
}

/** Wait for a follow-up job (e.g. the transcription an import started). */
export const waitForJob = (id: string, onProgress: (text: string) => void = () => {}) => finished(id, onProgress)
