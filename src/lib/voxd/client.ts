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
  speak: (body: SpeechRequest) => call(api().POST('/v1/speech', { body: { markup: false, ...body } })),
  takes: (limit = 50) => call(api().GET('/v1/takes', { params: { query: { limit } } })),
  searchTakes: (query: { q?: string; engine?: string; starred?: boolean; tag?: string; before?: number; limit?: number }) =>
    call(api().GET('/v1/takes', { params: { query } })),
  takeStats: () => call(api().GET('/v1/takes/stats')),
  deleteTakes: (ids: string[]) => call(api().POST('/v1/takes/delete', { body: { ids } })),

  jobs: (limit = 50) => call(api().GET('/v1/jobs', { params: { query: { limit } } })),
  job: (id: string) => call(api().GET('/v1/jobs/{job_id}', { params: { path: { job_id: id } } })),
  speakLong: (body: SpeechJobRequest) => call(api().POST('/v1/jobs/speech', { body: { markup: false, ...body } })),
  cancelJob: (id: string) => call(api().POST('/v1/jobs/{job_id}/cancel', { params: { path: { job_id: id } } })),
  clearJobs: () => call(api().DELETE('/v1/jobs')),

  system: () => call(api().GET('/v1/system')),
  models: () => call(api().GET('/v1/models')),
  downloadModel: (id: string) => call(api().POST('/v1/models/{model_id}/download', { params: { path: { model_id: id } } })),
  deleteModel: (id: string) => noContent(api().DELETE('/v1/models/{model_id}', { params: { path: { model_id: id } } })),

  settings: () => call(api().GET('/v1/settings')),
  updateSettings: (body: { compute_device?: string; history_retention_days?: number; asr_model?: string; model_mirror?: string }) => call(api().PATCH('/v1/settings', { body })),

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

  transcribe: (file: File, opts: { language?: string; model?: string; title?: string } = {}) =>
    upload<import('./types').Job>(
      '/v1/transcriptions',
      { file, ...(opts.language ? { language: opts.language } : {}), ...(opts.model ? { model: opts.model } : {}), ...(opts.title ? { title: opts.title } : {}) },
      'file',
    ),
  transcripts: (q?: string) => call(api().GET('/v1/transcriptions', { params: { query: q ? { q } : {} } })),
  transcript: (id: string) => call(api().GET('/v1/transcriptions/{transcript_id}', { params: { path: { transcript_id: id } } })),
  patchTranscript: (id: string, body: { title?: string; segments?: import('./types').Segment[] }) =>
    call(api().PATCH('/v1/transcriptions/{transcript_id}', { params: { path: { transcript_id: id } }, body })),
  deleteTranscript: (id: string) => noContent(api().DELETE('/v1/transcriptions/{transcript_id}', { params: { path: { transcript_id: id } } })),
  saveTranscript: (id: string, format: 'txt' | 'srt' | 'vtt' | 'json', path: string) =>
    noContent(
      api().POST('/v1/transcriptions/{transcript_id}/save', { params: { path: { transcript_id: id }, query: { format } }, body: { path, overwrite: true } }),
    ),
  transcriptExportUrl: (id: string, format: string) => withToken(`/v1/transcriptions/${id}/export`) + `${useVoxd.getState().state.token ? '&' : '?'}format=${format}`,
  transcriptAudioUrl: (id: string) => withToken(`/v1/transcriptions/${id}/audio`),
  liveUrl: (params: Record<string, string>) => {
    const base = withToken('/v1/transcribe/live').replace(/^http/, 'ws')
    const qs = new URLSearchParams(params).toString()
    return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base
  },

  dubLanguages: () => call(api().GET('/v1/dubs/languages')),
  dubs: () => call(api().GET('/v1/dubs')),
  dub: (id: string) => call(api().GET('/v1/dubs/{dub_id}', { params: { path: { dub_id: id } } })),
  createDub: (file: File, target: string, source?: string) =>
    upload<import('./types').Dub>('/v1/dubs', { file, target_language: target, ...(source ? { source_language: source } : {}) }, 'file'),
  patchDub: (id: string, body: import('./schema').components['schemas']['DubPatch']) =>
    call(api().PATCH('/v1/dubs/{dub_id}', { params: { path: { dub_id: id } }, body })),
  retranslateDub: (id: string, target?: string) =>
    call(api().POST('/v1/dubs/{dub_id}/translate', { params: { path: { dub_id: id } }, body: { target_language: target ?? null } })),
  renderDub: (id: string) => call(api().POST('/v1/dubs/{dub_id}/render', { params: { path: { dub_id: id } } })),
  previewDubLine: (id: string, line: string) =>
    call(api().POST('/v1/dubs/{dub_id}/segments/{segment_id}/preview', { params: { path: { dub_id: id, segment_id: line } } })),
  deleteDub: (id: string) => noContent(api().DELETE('/v1/dubs/{dub_id}', { params: { path: { dub_id: id } } })),
  saveDub: (id: string, what: 'video' | 'audio' | 'srt' | 'vtt', path: string) =>
    noContent(api().POST('/v1/dubs/{dub_id}/save', { params: { path: { dub_id: id } }, body: { path, what, overwrite: true } })),
  dubSubtitlesUrl: (id: string, format: 'srt' | 'vtt') => withToken(`/v1/dubs/${id}/subtitles`) + `${useVoxd.getState().state.token ? '&' : '?'}format=${format}`,
  mediaUrl: (path: string) => withToken(path),

  books: (kind?: 'audiobook' | 'story') => call(api().GET('/v1/books', { params: { query: kind ? { kind } : {} } })),
  book: (id: string) => call(api().GET('/v1/books/{book_id}', { params: { path: { book_id: id } } })),
  importBook: (input: { file?: File; text?: string; kind: string; title?: string; language?: string }) =>
    upload<import('./types').Book>(
      '/v1/books',
      {
        ...(input.file ? { file: input.file } : {}),
        ...(input.text ? { text: input.text } : {}),
        kind: input.kind,
        language: input.language ?? 'en',
        ...(input.title ? { title: input.title } : {}),
      },
      'file',
    ),
  patchBook: (id: string, body: import('./schema').components['schemas']['BookPatch']) =>
    call(api().PATCH('/v1/books/{book_id}', { params: { path: { book_id: id } }, body })),
  deleteBook: (id: string) => noContent(api().DELETE('/v1/books/{book_id}', { params: { path: { book_id: id } } })),
  renderBook: (id: string, chapters?: string[]) =>
    call(api().POST('/v1/books/{book_id}/render', { params: { path: { book_id: id } }, body: { chapters: chapters ?? null } })),
  chapterTimings: (id: string, chapter: string) =>
    call(api().GET('/v1/books/{book_id}/chapters/{chapter_id}/timings', { params: { path: { book_id: id, chapter_id: chapter } } })),
  exportBook: (id: string, format: 'm4b' | 'mp3') => call(api().POST('/v1/books/{book_id}/export', { params: { path: { book_id: id } }, body: { format } })),
  saveBook: (id: string, format: 'm4b' | 'mp3', path: string) =>
    noContent(api().POST('/v1/books/{book_id}/save', { params: { path: { book_id: id }, query: { format } }, body: { path, overwrite: true } })),

  batches: () => call(api().GET('/v1/batches')),
  createBatch: (body: import('./schema').components['schemas']['BatchIn']) => call(api().POST('/v1/batches', { body })),
  cancelBatch: (id: string) => call(api().POST('/v1/batches/{batch_id}/cancel', { params: { path: { batch_id: id } } })),
  deleteBatch: (id: string) => noContent(api().DELETE('/v1/batches/{batch_id}', { params: { path: { batch_id: id } } })),
  watchFolders: () => call(api().GET('/v1/watch-folders')),
  addWatchFolder: (body: import('./schema').components['schemas']['WatchFolderIn']) => call(api().POST('/v1/watch-folders', { body })),
  setWatchFolder: (id: string, enabled: boolean) =>
    call(api().PATCH('/v1/watch-folders/{watch_id}', { params: { path: { watch_id: id } }, body: { enabled } })),
  removeWatchFolder: (id: string) => noContent(api().DELETE('/v1/watch-folders/{watch_id}', { params: { path: { watch_id: id } } })),

  projects: () => call(api().GET('/v1/projects')),
  project: (id: string) => call(api().GET('/v1/projects/{project_id}', { params: { path: { project_id: id } } })),
  createProject: (name: string, color: string) => call(api().POST('/v1/projects', { body: { name, color, description: '' } })),
  patchProject: (id: string, body: { name?: string; color?: string; description?: string }) =>
    call(api().PATCH('/v1/projects/{project_id}', { params: { path: { project_id: id } }, body })),
  deleteProject: (id: string) => noContent(api().DELETE('/v1/projects/{project_id}', { params: { path: { project_id: id } } })),
  addToProject: (project: string, kind: string, id: string) =>
    noContent(api().POST('/v1/projects/{project_id}/items', { params: { path: { project_id: project } }, body: { kind, id } })),
  removeFromProject: (project: string, kind: string, id: string) =>
    noContent(api().DELETE('/v1/projects/{project_id}/items/{kind}/{item_id}', { params: { path: { project_id: project, kind, item_id: id } } })),
  membership: (kind: string, id: string) => call(api().GET('/v1/projects/membership', { params: { query: { kind, id } } })),
  exportHistory: () => call(api().GET('/v1/exports')),

  cleanAudio: (source: File | string, opts: { denoise: boolean; trim: boolean; normalize: boolean; loudness: number }) =>
    upload<import('./types').Job>(
      '/v1/tools/clean',
      { ...(typeof source === 'string' ? { take_id: source } : { file: source }), denoise: String(opts.denoise), trim: String(opts.trim), normalize: String(opts.normalize), loudness: String(opts.loudness) },
      'file',
    ),
  convertVoice: (source: File | string, voice: string) =>
    upload<import('./types').Job>('/v1/tools/convert', { ...(typeof source === 'string' ? { take_id: source } : { file: source }), voice }, 'file'),
  pronunciations: () => call(api().GET('/v1/pronunciations')),
  addPronunciation: (body: { term: string; say: string; case_sensitive?: boolean }) => call(api().POST('/v1/pronunciations', { body: { case_sensitive: false, ...body } })),
  patchPronunciation: (id: string, body: { term?: string; say?: string; case_sensitive?: boolean }) =>
    call(api().PATCH('/v1/pronunciations/{pid}', { params: { path: { pid: id } }, body })),
  deletePronunciation: (id: string) => noContent(api().DELETE('/v1/pronunciations/{pid}', { params: { path: { pid: id } } })),
  previewPronunciation: (text: string) => call(api().POST('/v1/pronunciations/preview', { body: { text } })),

  status: () => call(api().GET('/v1/status')),
  storage: () => call(api().GET('/v1/storage')),
  cleanupStorage: () => call(api().POST('/v1/storage/cleanup')),
  unloadEngines: () => call(api().POST('/v1/engines/unload')),
  connection: () => call(api().GET('/v1/connection')),
  apiKeys: () => call(api().GET('/v1/keys')),
  createApiKey: (name: string) => call(api().POST('/v1/keys', { body: { name } })),
  revokeApiKey: (id: string) => noContent(api().DELETE('/v1/keys/{key_id}', { params: { path: { key_id: id } } })),
  openapi: async () => {
    const { url } = useVoxd.getState().state
    if (!url) throw new VoxdError('offline', 'The voice engine is not running', 0)
    return (await fetch(`${url}/openapi.json`)).json() as Promise<OpenApiDoc>
  },
  /** Raw request for the API explorer; returns status, content type and a printable body. */
  raw: async (method: string, path: string, body?: string) => {
    const { url, token } = useVoxd.getState().state
    if (!url) throw new VoxdError('offline', 'The voice engine is not running', 0)
    const started = performance.now()
    const res = await fetch(url + path, {
      method,
      body: body || undefined,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    })
    const type = res.headers.get('content-type') ?? ''
    const text = type.includes('json') ? JSON.stringify(await res.json(), null, 2) : type.startsWith('text/') ? await res.text() : `(${type || 'binary'} · ${(await res.blob()).size} bytes)`
    return { status: res.status, type, text, ms: Math.round(performance.now() - started) }
  },

  editTakes: (body: import('./schema').components['schemas']['EditIn']) => call(api().POST('/v1/takes/edit', { body })),
  rate: (body: import('./schema').components['schemas']['RatingIn']) => call(api().POST('/v1/ratings', { body })),
  leaderboard: (language?: string) => call(api().GET('/v1/ratings/leaderboard', { params: { query: language ? { language } : {} } })),
  clearRatings: (language?: string) => call(api().DELETE('/v1/ratings', { params: { query: language ? { language } : {} } })),
  markupPreview: (text: string, speed = 1) => call(api().POST('/v1/markup/preview', { body: { text, speed } })),
  /** A local file the user opened with VoxStudio (Finder), as a File. */
  localFile: async (path: string) => {
    const res = await fetch(withToken('/v1/files/read') + `${useVoxd.getState().state.token ? '&' : '?'}path=${encodeURIComponent(path)}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new VoxdError(body.error ?? 'http_error', body.message ?? res.statusText, res.status)
    }
    const blob = await res.blob()
    return new File([blob], path.split(/[\\/]/).pop() || 'file', { type: blob.type })
  },
  tagTake: (id: string, tags: string[]) => call(api().PUT('/v1/takes/{take_id}/tags', { params: { path: { take_id: id } }, body: { tags } })),
  tagProject: (id: string, tags: string[]) => call(api().PUT('/v1/projects/{project_id}/tags', { params: { path: { project_id: id } }, body: { tags } })),
  tags: () => call(api().GET('/v1/tags')),
  collection: (tag: string) => call(api().GET('/v1/tags/{tag}', { params: { path: { tag } } })),
  renameTag: (tag: string, to: string) => noContent(api().POST('/v1/tags/{tag}/rename', { params: { path: { tag } }, body: { to } })),
  deleteTag: (tag: string) => noContent(api().DELETE('/v1/tags/{tag}', { params: { path: { tag } } })),
  importUrl: (body: import('./schema').components['schemas']['ImportUrlIn']) => call(api().POST('/v1/imports/url', { body })),
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

/** The subset of OpenAPI 3.1 the API explorer reads. */
export interface OpenApiDoc {
  paths: Record<string, Record<string, OpenApiOperation>>
  components?: { schemas?: Record<string, OpenApiSchema> }
}
export interface OpenApiOperation {
  summary?: string
  description?: string
  tags?: string[]
  parameters?: { name: string; in: string; required?: boolean; description?: string; schema?: OpenApiSchema }[]
  requestBody?: { content: Record<string, { schema?: OpenApiSchema }> }
}
export interface OpenApiSchema {
  $ref?: string
  type?: string | string[]
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  description?: string
  default?: unknown
  enum?: unknown[]
  items?: OpenApiSchema
  anyOf?: OpenApiSchema[]
  title?: string
  minimum?: number
  maximum?: number
  format?: string
}
