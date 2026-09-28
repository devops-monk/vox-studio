import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { voxd } from './client'
import { useLive } from './events'
import { useVoxd } from './state'
import { isActive, type Job, type LibraryVoice, type SpeechJobRequest, type SpeechRequest } from './types'

const useReady = () => useVoxd((s) => s.state.phase === 'ready')

export const useEngines = () => useQuery({ queryKey: ['engines'], queryFn: voxd.engines, enabled: useReady() })

export const useVoices = (engine: string) =>
  useQuery({ queryKey: ['voices', engine], queryFn: () => voxd.voices(engine), enabled: useReady(), staleTime: Infinity })

export const useTakes = (limit = 50) => useQuery({ queryKey: ['takes', limit], queryFn: () => voxd.takes(limit), enabled: useReady() })

const POLL_MS = 1000

/** Live via the events socket; polls only while the socket is down and work is in flight. */
export function useJobs() {
  const live = useLive((s) => s.connected)
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => voxd.jobs(30),
    enabled: useReady(),
    staleTime: Infinity,
    refetchInterval: (q) => (!live && q.state.data?.some(isActive) ? POLL_MS : false),
  })
}

export function useJob(id: string | null) {
  const live = useLive((s) => s.connected)
  return useQuery<Job>({
    queryKey: ['job', id],
    queryFn: () => voxd.job(id!),
    enabled: useReady() && !!id,
    staleTime: Infinity,
    refetchInterval: (q) => (!live && (!q.state.data || isActive(q.state.data)) ? POLL_MS : false),
  })
}

export function useSpeak() {
  return useMutation({ mutationFn: (body: SpeechRequest) => voxd.speak(body) })
}

export function useSpeakLong() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SpeechJobRequest) => voxd.speakLong(body),
    // Live events can beat this response; never let the older snapshot win.
    onSuccess: (job) => qc.setQueryData<Job>(['job', job.id], (seen) => newer(seen, job)),
  })
}

export const useCancelJob = () => useMutation({ mutationFn: voxd.cancelJob })

export function useClearJobs() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: voxd.clearJobs, onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) })
}

/** The more recent of two snapshots of the same job. */
export const newer = (a: Job | undefined, b: Job) => (a && a.updated_at >= b.updated_at ? a : b)

export const useSystem = () => useQuery({ queryKey: ['system'], queryFn: voxd.system, enabled: useReady(), staleTime: 60_000 })

export const useModels = () => useQuery({ queryKey: ['models'], queryFn: voxd.models, enabled: useReady() })

export function useDownloadModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: voxd.downloadModel,
    onSuccess: (job) => {
      qc.setQueryData<Job>(['job', job.id], (seen) => newer(seen, job))
      void qc.invalidateQueries({ queryKey: ['models'] })
    },
  })
}

export function useDeleteModel() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: voxd.deleteModel, onSuccess: () => qc.invalidateQueries({ queryKey: ['models'] }) })
}

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: voxd.settings, enabled: useReady() })

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: voxd.updateSettings, onSuccess: (s) => qc.setQueryData(['settings'], s) })
}

export const useCustomVoices = () => useQuery({ queryKey: ['custom-voices'], queryFn: voxd.customVoices, enabled: useReady() })

function useInvalidateVoices() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['custom-voices'] })
    void qc.invalidateQueries({ queryKey: ['voices'] })
    void qc.invalidateQueries({ queryKey: ['library'] })
    void qc.invalidateQueries({ queryKey: ['designed-voices'] })
  }
}

export function useCreateCustomVoice() {
  const invalidate = useInvalidateVoices()
  return useMutation({ mutationFn: voxd.createCustomVoice, onSuccess: invalidate })
}

export function useDeleteCustomVoice() {
  const invalidate = useInvalidateVoices()
  return useMutation({ mutationFn: voxd.deleteCustomVoice, onSuccess: invalidate })
}

export function useStarTake() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) => voxd.starTake(id, starred),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['takes'] }),
  })
}

export const useLibrary = () => useQuery({ queryKey: ['library'], queryFn: voxd.library, enabled: useReady() })

/**
 * Favorite/tag a voice, updating the library optimistically. Changes run one at a time and the
 * library is only refetched after the last one settles, so a refetch can't overwrite newer edits.
 */
export function useVoiceMeta() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['voice-meta'],
    scope: { id: 'voice-meta' },
    mutationFn: voxd.setVoiceMeta,
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: ['library'] })
      const before = qc.getQueryData<LibraryVoice[]>(['library'])
      qc.setQueryData<LibraryVoice[]>(['library'], (list) =>
        list?.map((v) =>
          v.id === change.voice && (v.custom || v.engine === change.engine)
            ? { ...v, favorite: change.favorite ?? v.favorite, tags: change.tags ?? v.tags }
            : v,
        ),
      )
      return { before }
    },
    onError: (_e, _c, ctx) => ctx?.before && qc.setQueryData(['library'], ctx.before),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: ['voice-meta'] }) === 1) void qc.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useImportVoice() {
  const invalidate = useInvalidateVoices()
  return useMutation({
    mutationFn: ({ file, consent, consentBy }: { file: File; consent: string; consentBy?: string }) => voxd.importVoice(file, consent, consentBy),
    onSuccess: invalidate,
  })
}

export function useRenameVoice() {
  const invalidate = useInvalidateVoices()
  return useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => voxd.renameCustomVoice(id, name), onSuccess: invalidate })
}

export function useDesignStatus() {
  const live = useLive((s) => s.connected)
  return useQuery({
    queryKey: ['design-status'],
    queryFn: voxd.designStatus,
    enabled: useReady(),
    refetchInterval: (q) => (q.state.data?.job_id && !live ? POLL_MS : false),
  })
}

export function useDesignAnalyze() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: voxd.designAnalyze,
    onSuccess: (job) => {
      qc.setQueryData<Job>(['job', job.id], (seen) => newer(seen, job))
      void qc.invalidateQueries({ queryKey: ['design-status'] })
    },
  })
}

export const useDesignedVoices = () => useQuery({ queryKey: ['designed-voices'], queryFn: voxd.designedVoices, enabled: useReady() })

export function useSaveDesigned() {
  const qc = useQueryClient()
  const invalidate = useInvalidateVoices()
  return useMutation({
    mutationFn: voxd.saveDesigned,
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: ['designed-voices'] })
    },
  })
}

export interface HistoryFilter {
  q?: string
  engine?: string
  starred?: boolean
}

const PAGE = 40

/** Take history, newest first, paged by creation time. */
export function useHistory(filter: HistoryFilter) {
  return useInfiniteQuery({
    queryKey: ['takes', 'history', filter],
    queryFn: ({ pageParam }) => voxd.searchTakes({ ...filter, before: pageParam, limit: PAGE }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
    enabled: useReady(),
  })
}

export const useTakeStats = () => useQuery({ queryKey: ['takes', 'stats'], queryFn: voxd.takeStats, enabled: useReady() })

export function useDeleteTakes() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: voxd.deleteTakes, onSuccess: () => qc.invalidateQueries({ queryKey: ['takes'] }) })
}

export const useTranscripts = (q?: string) => useQuery({ queryKey: ['transcripts', q ?? ''], queryFn: () => voxd.transcripts(q), enabled: useReady() })

export const useTranscript = (id: string | null) =>
  useQuery({ queryKey: ['transcript', id], queryFn: () => voxd.transcript(id!), enabled: useReady() && !!id })

export function usePatchTranscript() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; segments?: import('./types').Segment[] }) => voxd.patchTranscript(id, body),
    onSuccess: (t) => {
      qc.setQueryData(['transcript', t.id], t)
      void qc.invalidateQueries({ queryKey: ['transcripts'] })
    },
  })
}

export const useDubLanguages = () => useQuery({ queryKey: ['dub-languages'], queryFn: voxd.dubLanguages, enabled: useReady() })
export const useDubs = () => useQuery({ queryKey: ['dubs'], queryFn: voxd.dubs, enabled: useReady() })
export function useDub(id: string | null) {
  const live = useLive((s) => s.connected)
  return useQuery({
    queryKey: ['dub', id],
    queryFn: () => voxd.dub(id!),
    enabled: useReady() && !!id,
    refetchInterval: (q) => (!live && q.state.data?.job_id ? POLL_MS : false),
  })
}

export const useBooks = (kind?: 'audiobook' | 'story') => useQuery({ queryKey: ['books', kind ?? 'all'], queryFn: () => voxd.books(kind), enabled: useReady() })
export function useBook(id: string | null) {
  const live = useLive((s) => s.connected)
  return useQuery({
    queryKey: ['book', id],
    queryFn: () => voxd.book(id!),
    enabled: useReady() && !!id,
    refetchInterval: (q) => (!live && q.state.data?.job_id ? POLL_MS : false),
  })
}
export const useChapterTimings = (bookId: string, chapterId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['timings', bookId, chapterId],
    queryFn: () => voxd.chapterTimings(bookId, chapterId!),
    enabled: useReady() && !!chapterId && enabled,
  })

export function useBatches() {
  const live = useLive((s) => s.connected)
  return useQuery({
    queryKey: ['batches'],
    queryFn: voxd.batches,
    enabled: useReady(),
    refetchInterval: (q) => (!live && q.state.data?.some((b) => b.done + b.failed < b.total) ? POLL_MS : false),
  })
}
export const useWatchFolders = () => useQuery({ queryKey: ['watch-folders'], queryFn: voxd.watchFolders, enabled: useReady(), refetchInterval: 10_000 })

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: voxd.projects, enabled: useReady() })
export const useProject = (id: string | null) => useQuery({ queryKey: ['project', id], queryFn: () => voxd.project(id!), enabled: useReady() && !!id })
export const useMembership = (kind: string, id: string, enabled: boolean) =>
  useQuery({ queryKey: ['membership', kind, id], queryFn: () => voxd.membership(kind, id), enabled: useReady() && enabled })
export const useExportHistory = () => useQuery({ queryKey: ['exports'], queryFn: voxd.exportHistory, enabled: useReady() })
export const usePronunciations = () => useQuery({ queryKey: ['pronunciations'], queryFn: voxd.pronunciations, enabled: useReady() })
export const useConnection = () => useQuery({ queryKey: ['connection'], queryFn: voxd.connection, enabled: useReady(), staleTime: Infinity })
export const useApiKeys = () => useQuery({ queryKey: ['api-keys'], queryFn: voxd.apiKeys, enabled: useReady() })
export const useOpenApi = () => useQuery({ queryKey: ['openapi'], queryFn: voxd.openapi, enabled: useReady(), staleTime: Infinity })
