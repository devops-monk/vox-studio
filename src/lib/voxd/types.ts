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
export type DesignResult = Schemas['DesignOut']
export type DesignCandidate = Schemas['CandidateOut']
export type DesignedVoice = Schemas['DesignedVoiceOut']
export type DesignRequest = Schemas['DesignIn']
export type Transcript = Schemas['TranscriptOut']
export type TranscriptSummary = Schemas['TranscriptSummaryOut']
export type Segment = Schemas['SegmentOut']
export type Dub = Schemas['DubOut']
export type DubSummary = Schemas['DubSummaryOut']
export type DubLine = Schemas['DubSegmentOut']
export type DubLanguage = Schemas['DubLanguageOut']
export type Book = Schemas['BookOut']
export type BookSummary = Schemas['BookSummaryOut']
export type Chapter = Schemas['ChapterOut']
export type Batch = Schemas['BatchOut']
export type WatchFolder = Schemas['WatchFolderOut']
export type Project = Schemas['ProjectOut']
export type ProjectSummary = Schemas['ProjectSummaryOut']
export type ExportRecord = Schemas['ExportRecordOut']
export type ProjectKind = 'take' | 'transcript' | 'dub' | 'book'
export interface Timing {
  start: number
  end: number
  from: number
  to: number
  speaker: string | null
}

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
export type Pronunciation = Schemas['PronunciationOut']
