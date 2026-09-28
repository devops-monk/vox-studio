import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Clip {
  /** Local id (a take can appear in several clips). */
  id: string
  takeId: string
  /** Seconds into the take. */
  start: number
  end: number
  gainDb: number
}

export interface Mix {
  gapS: number
  crossfadeMs: number
  fadeInS: number
  fadeOutS: number
  gainDb: number
  normalize: boolean
}

interface Doc {
  clips: Clip[]
  mix: Mix
}

interface EditorState extends Doc {
  title: string
  selected: string | null
  past: Doc[]
  future: Doc[]
  /** Change the document; each call is one undo step unless `merge` (e.g. while dragging). */
  edit: (fn: (doc: Doc) => Doc, merge?: boolean) => void
  undo: () => void
  redo: () => void
  select: (id: string | null) => void
  setTitle: (title: string) => void
  reset: () => void
}

export const DEFAULT_MIX: Mix = { gapS: 0, crossfadeMs: 10, fadeInS: 0, fadeOutS: 0, gainDb: 0, normalize: false }
const HISTORY = 100
let lastMerge = 0

export const newClipId = () => Math.random().toString(36).slice(2, 10)

/** The editor's draft survives restarts, like the Studio script. */
export const useEditor = create<EditorState>()(
  persist(
    (set, get) => ({
      clips: [],
      mix: DEFAULT_MIX,
      title: '',
      selected: null,
      past: [],
      future: [],
      edit: (fn, merge = false) => {
        const { clips, mix, past } = get()
        const next = fn({ clips, mix })
        // Merged edits (a drag) share one undo step while they keep coming.
        const now = Date.now()
        const coalesce = merge && now - lastMerge < 400
        lastMerge = merge ? now : 0
        set({ ...next, past: coalesce ? past : [...past.slice(-HISTORY + 1), { clips, mix }], future: [] })
      },
      undo: () => {
        const { past, future, clips, mix } = get()
        const prev = past.at(-1)
        if (prev) set({ ...prev, past: past.slice(0, -1), future: [{ clips, mix }, ...future] })
      },
      redo: () => {
        const { past, future, clips, mix } = get()
        const next = future[0]
        if (next) set({ ...next, past: [...past, { clips, mix }], future: future.slice(1) })
      },
      select: (selected) => set({ selected }),
      setTitle: (title) => set({ title }),
      reset: () => set({ clips: [], mix: DEFAULT_MIX, title: '', selected: null, past: [], future: [] }),
    }),
    { name: 'voxstudio.editor', partialize: (s) => ({ clips: s.clips, mix: s.mix, title: s.title }) },
  ),
)

/** Where each clip starts on the timeline, and the total length. Joins overlap by the crossfade. */
export function layout(clips: Clip[], mix: Mix) {
  const xfade = mix.gapS > 0 ? 0 : mix.crossfadeMs / 1000
  const positions: number[] = []
  let t = 0
  clips.forEach((c, i) => {
    const dur = c.end - c.start
    if (i > 0) t = mix.gapS > 0 ? t + mix.gapS : t - Math.min(xfade, dur, clips[i - 1].end - clips[i - 1].start)
    positions.push(t)
    t += dur
  })
  return { positions, total: Math.max(0, t) }
}
