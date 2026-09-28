import { create } from 'zustand'
import { queryClient } from '@/lib/query'
import { voxd } from './client'
import { newer } from './queries'
import { useVoxd } from './state'
import type { Job, Take } from './types'

type Message =
  | { type: 'hello'; data: unknown }
  | { type: 'job'; data: Job }
  | { type: 'take.created'; data: Take }
  | { type: 'models.changed'; data: { id: string; installed: boolean } }
  | { type: 'voices.changed'; data: { id: string } }
  | { type: 'take.updated'; data: Take }
  | { type: 'design.ready'; data: { voices: number } }
  | { type: 'takes.deleted'; data: { ids: string[] } }
  | { type: 'transcripts.changed'; data: { id: string } }
  | { type: 'dubs.changed'; data: { id: string } }
  | { type: 'books.changed'; data: { id: string } }
  | { type: 'batches.changed'; data: { id: string } }
  | { type: 'watch.changed'; data: { id: string } }

/** Whether live events are flowing; queries fall back to polling while they aren't. */
export const useLive = create<{ connected: boolean }>(() => ({ connected: false }))

let socket: WebSocket | null = null
let retry = 0
let timer: ReturnType<typeof setTimeout> | undefined

/** Keeps a WebSocket to voxd open whenever it is ready and folds live events into the query cache. */
export function connectEvents() {
  let lastKey = ''
  useVoxd.subscribe(({ state }) => {
    const key = state.phase === 'ready' ? `${state.url}|${state.token}` : ''
    if (key === lastKey) return
    lastKey = key
    close()
    if (key) open()
  })
}

function open() {
  clearTimeout(timer)
  const ws = new WebSocket(voxd.eventsUrl())
  socket = ws
  ws.onopen = () => {
    retry = 0
    useLive.setState({ connected: true })
    // Anything could have changed while we were disconnected.
    void queryClient.invalidateQueries()
  }
  ws.onmessage = (e) => apply(JSON.parse(e.data) as Message)
  ws.onclose = () => {
    useLive.setState({ connected: false })
    if (socket !== ws) return // closed on purpose
    socket = null
    timer = setTimeout(open, Math.min(8000, 500 * 2 ** retry++))
  }
}

function close() {
  clearTimeout(timer)
  const ws = socket
  socket = null
  ws?.close()
}

function apply(message: Message) {
  switch (message.type) {
    case 'job': {
      const job = message.data
      queryClient.setQueryData<Job>(['job', job.id], (seen) => newer(seen, job))
      queryClient.setQueriesData<Job[]>({ queryKey: ['jobs'] }, (jobs) => {
        if (!jobs) return jobs
        const rest = jobs.filter((j) => j.id !== job.id)
        return [job, ...rest].sort((a, b) => b.created_at - a.created_at)
      })
      // A download that stopped (cancelled/failed) changes the model's status too.
      if (job.kind.startsWith('batch.')) {
        void queryClient.invalidateQueries({ queryKey: ['batches'] })
        if (job.status === 'succeeded' || job.status === 'failed') void queryClient.invalidateQueries({ queryKey: ['watch-folders'] })
      }
      if (job.kind.startsWith('book.') && job.status !== 'running' && job.status !== 'queued') {
        void queryClient.invalidateQueries({ queryKey: ['book'] })
        void queryClient.invalidateQueries({ queryKey: ['books'] })
      }
      if (job.kind.startsWith('dub.') && job.status !== 'running' && job.status !== 'queued') {
        void queryClient.invalidateQueries({ queryKey: ['dub'] })
        void queryClient.invalidateQueries({ queryKey: ['dubs'] })
      }
      if (job.kind === 'design.analyze' && job.status !== 'running') void queryClient.invalidateQueries({ queryKey: ['design-status'] })
      if (job.kind === 'model.download' && (job.status === 'cancelled' || job.status === 'failed')) {
        void queryClient.invalidateQueries({ queryKey: ['models'] })
      }
      break
    }
    case 'models.changed':
      for (const key of ['models', 'engines', 'voices', 'system', 'library']) void queryClient.invalidateQueries({ queryKey: [key] })
      break
    case 'take.created':
    case 'take.updated':
    case 'takes.deleted':
      void queryClient.invalidateQueries({ queryKey: ['takes'] })
      break
    case 'batches.changed':
      void queryClient.invalidateQueries({ queryKey: ['batches'] })
      break
    case 'watch.changed':
      void queryClient.invalidateQueries({ queryKey: ['watch-folders'] })
      break
    case 'books.changed':
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book', message.data.id] })
      void queryClient.invalidateQueries({ queryKey: ['timings', message.data.id] })
      break
    case 'dubs.changed':
      void queryClient.invalidateQueries({ queryKey: ['dubs'] })
      void queryClient.invalidateQueries({ queryKey: ['dub', message.data.id] })
      break
    case 'transcripts.changed':
      void queryClient.invalidateQueries({ queryKey: ['transcripts'] })
      void queryClient.invalidateQueries({ queryKey: ['transcript', message.data.id] })
      break
    case 'design.ready':
      void queryClient.invalidateQueries({ queryKey: ['design-status'] })
      break
    case 'voices.changed':
      void queryClient.invalidateQueries({ queryKey: ['designed-voices'] })
      // Our own favorite/tag edits also echo back here; don't clobber ones still in flight.
      if (!queryClient.isMutating({ mutationKey: ['voice-meta'] })) void queryClient.invalidateQueries({ queryKey: ['library'] })
      void queryClient.invalidateQueries({ queryKey: ['custom-voices'] })
      void queryClient.invalidateQueries({ queryKey: ['voices'] })
      break
  }
}
