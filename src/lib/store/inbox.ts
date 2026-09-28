import { create } from 'zustand'

export type InboxTarget = 'clone' | 'clean' | 'convert'

/** A dropped file waiting for a page to pick it up (Drop Anywhere → Clone / Tools). */
export const useInbox = create<{
  file: File | null
  target: InboxTarget | null
  put: (target: InboxTarget, file: File) => void
  take: (target: InboxTarget) => File | null
}>((set, get) => ({
  file: null,
  target: null,
  put: (target, file) => set({ target, file }),
  take: (target) => {
    const { file, target: t } = get()
    if (!file || t !== target) return null
    set({ file: null, target: null })
    return file
  },
}))
