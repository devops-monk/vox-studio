import createClient from 'openapi-fetch'
import type { paths } from './schema'
import { useVoxd } from './state'
import type { SpeechJobRequest, SpeechRequest, Take } from './types'

export class VoxdError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

let cached: { key: string; client: ReturnType<typeof createClient<paths>> } | null = null

/** A typed client bound to the current voxd url + token (rebuilt if voxd restarts on a new port). */
function api() {
  const { url, token } = useVoxd.getState().state
  if (!url) throw new VoxdError('offline', 'The voice engine is not running', 0)
  const key = `${url}|${token}`
  if (cached?.key !== key) {
    cached = { key, client: createClient<paths>({ baseUrl: url, headers: token ? { Authorization: `Bearer ${token}` } : {} }) }
  }
  return cached.client
}

/** Unwraps an openapi-fetch result, turning voxd's `{error, message}` bodies into VoxdError. */
async function call<T>(promise: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await promise
  if (error !== undefined || data === undefined) {
    const body = (error ?? {}) as { error?: string; message?: string }
    throw new VoxdError(body.error ?? 'http_error', body.message ?? response.statusText, response.status)
  }
  return data
}

export const voxd = {
  engines: () => call(api().GET('/v1/engines')),
  voices: (engine: string) => call(api().GET('/v1/voices', { params: { query: { engine } } })),
  speak: (body: SpeechRequest) => call(api().POST('/v1/speech', { body })),
  takes: (limit = 50) => call(api().GET('/v1/takes', { params: { query: { limit } } })),
  searchTakes: (query: { q?: string; engine?: string; starred?: boolean; before?: number; limit?: number }) =>
    call(api().GET('/v1/takes', { params: { query } })),
  takeStats: () => call(api().GET('/v1/takes/stats')),
  deleteTakes: (ids: string[]) => call(api().POST('/v1/takes/delete', { body: { ids } })),

  jobs: (limit = 50) => call(api().GET('/v1/jobs', { params: { query: { limit } } })),
  job: (id: string) => call(api().GET('/v1/jobs/{job_id}', { params: { path: { job_id: id } } })),
  speakLong: (body: SpeechJobRequest) => call(api().POST('/v1/jobs/speech', { body })),
  cancelJob: (id: string) => call(api().POST('/v1/jobs/{job_id}/cancel', { params: { path: { job_id: id } } })),
  clearJobs: () => call(api().DELETE('/v1/jobs')),

  system: () => call(api().GET('/v1/system')),
  models: () => call(api().GET('/v1/models')),
  downloadModel: (id: string) => call(api().POST('/v1/models/{model_id}/download', { params: { path: { model_id: id } } })),
  deleteModel: (id: string) => noContent(api().DELETE('/v1/models/{model_id}', { params: { path: { model_id: id } } })),

  settings: () => call(api().GET('/v1/settings')),
  updateSettings: (body: { compute_device?: string; history_retention_days?: number }) => call(api().PATCH('/v1/settings', { body })),

  customVoices: () => call(api().GET('/v1/voices/custom')),
  /** Upload a WAV recording as a new voice (multipart). */
  createCustomVoice: (input: { name: string; consent: string; consentBy?: string; language?: string; audio: Blob }) =>
    upload<import('./types').CustomVoice>(
      '/v1/voices/custom',
      { audio: input.audio, name: input.name, consent: input.consent, consent_by: input.consentBy ?? '', language: input.language ?? 'en-US' },
      'audio',
    ),
  renameCustomVoice: (id: string, name: string) =>
    call(api().PATCH('/v1/voices/custom/{voice_id}', { params: { path: { voice_id: id } }, body: { name } })),
  deleteCustomVoice: (id: string) => noContent(api().DELETE('/v1/voices/custom/{voice_id}', { params: { path: { voice_id: id } } })),

  library: () => call(api().GET('/v1/voices/library')),
  setVoiceMeta: (body: { engine: string; voice: string; favorite?: boolean; tags?: string[] }) => noContent(api().PUT('/v1/voices/meta', { body })),
  exportVoice: (id: string, path: string) =>
    noContent(api().POST('/v1/voices/custom/{voice_id}/export', { params: { path: { voice_id: id } }, body: { path, overwrite: true } })),
  importVoice: (file: Blob, consent: string, consentBy = '') =>
    upload<import('./types').CustomVoice>('/v1/voices/custom/import', { file, consent, consent_by: consentBy }, 'file'),

  designStatus: () => call(api().GET('/v1/design/status')),
  designAnalyze: () => call(api().POST('/v1/design/analyze')),
  designCandidates: (body: import('./types').DesignRequest) => call(api().POST('/v1/design/candidates', { body })),
  designedVoices: () => call(api().GET('/v1/voices/designed')),
  saveDesigned: (body: { name: string; recipe: string; description: string; speed: number }) => call(api().POST('/v1/voices/designed', { body })),
  renameDesigned: (id: string, name: string) =>
    call(api().PATCH('/v1/voices/designed/{voice_id}', { params: { path: { voice_id: id } }, body: { name } })),
  deleteDesigned: (id: string) => noContent(api().DELETE('/v1/voices/designed/{voice_id}', { params: { path: { voice_id: id } } })),

  starTake: (id: string, starred: boolean) => call(api().PUT('/v1/takes/{take_id}/star', { params: { path: { take_id: id } }, body: { starred } })),
  exportTake: (id: string, path: string, overwrite = false) =>
    noContent(api().POST('/v1/takes/{take_id}/export', { params: { path: { take_id: id } }, body: { path, overwrite } })),

  /** A URL usable directly as an <audio> src. */
  audioUrl: (item: Pick<Take, 'audio_url'>) => withToken(item.audio_url),
  /** WebSocket URL for app-wide live events. */
  eventsUrl: () => withToken('/v1/events').replace(/^http/, 'ws'),
}

/** Multipart POST (openapi-fetch doesn't serialize files); `fileField` is sent as a named file. */
async function upload<T>(path: string, fields: Record<string, string | Blob>, fileField: string): Promise<T> {
  const { url, token } = useVoxd.getState().state
  if (!url) throw new VoxdError('offline', 'The voice engine is not running', 0)
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (k === fileField && v instanceof Blob) form.set(k, v, v instanceof File ? v.name : 'upload.bin')
    else form.set(k, v)
  }
  const res = await fetch(url + path, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new VoxdError(body.error ?? 'http_error', body.message ?? res.statusText, res.status)
  return body as T
}

/** For 204 responses: only errors carry a body. */
async function noContent(promise: Promise<{ error?: unknown; response: Response }>): Promise<void> {
  const { error, response } = await promise
  if (!response.ok) {
    const body = (error ?? {}) as { error?: string; message?: string }
    throw new VoxdError(body.error ?? 'http_error', body.message ?? response.statusText, response.status)
  }
}

function withToken(path: string) {
  const { url, token } = useVoxd.getState().state
  if (!url) throw new VoxdError('offline', 'The voice engine is not running', 0)
  return `${url}${path}${token ? `?token=${token}` : ''}`
}
