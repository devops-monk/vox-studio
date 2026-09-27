import type { components } from './schema'

type Schemas = components['schemas']

// API shapes come from voxd's OpenAPI schema (`npm run api:gen`); never hand-edit them here.
export type Engine = Schemas['EngineOut']
export type Voice = Schemas['VoiceOut']
export type Take = Schemas['TakeOut']
export type Job = Schemas['JobOut']
export type SpeechRequest = Schemas['SpeechIn']
export type SpeechJobRequest = Schemas['SpeechJobIn']
export type Model = Schemas['ModelOut']
export type SystemInfo = Schemas['SystemOut']
export type Settings = Schemas['SettingsOut']
export type CustomVoice = Schemas['CustomVoiceOut']
export type LibraryVoice = Schemas['LibraryVoiceOut']

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export const isActive = (job: Job) => job.status === 'queued' || job.status === 'running'

/** Result payload of a `speech` job. */
export interface SpeechJobResult {
  take_id: string
  audio_url: string
  duration_s: number
}

// Shell-side state (not part of the HTTP API).
export type VoxdPhase = 'starting' | 'booting' | 'loading_engines' | 'ready' | 'error' | 'stopped'

export interface VoxdState {
  phase: VoxdPhase
  detail: string | null
  url: string | null
  token: string
  restarts: number
}
