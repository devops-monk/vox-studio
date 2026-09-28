import { create } from 'zustand'

/**
 * A key created during this session, so setup snippets can include it. Keys are shown once and
 * never persisted by the UI; after a restart snippets fall back to a placeholder.
 */
export const useSessionKey = create<{ key: string | null; set: (key: string | null) => void }>((set) => ({
  key: null,
  set: (key) => set({ key }),
}))

export const KEY_PLACEHOLDER = 'YOUR_VOXSTUDIO_KEY'
