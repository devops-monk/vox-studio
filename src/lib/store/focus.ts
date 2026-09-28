import { create } from 'zustand'

/** One-shot "open this item" requests between pages (e.g. Projects → a specific dub). */
interface Focus {
  dub: string | null
  book: string | null
  transcript: string | null
  open: (kind: 'dub' | 'book' | 'transcript', id: string) => void
  take: (kind: 'dub' | 'book' | 'transcript') => string | null
}

export const useFocus = create<Focus>((set, get) => ({
  dub: null,
  book: null,
  transcript: null,
  open: (kind, id) => set({ [kind]: id } as Partial<Focus>),
  take: (kind) => {
    const id = get()[kind]
    if (id) set({ [kind]: null } as Partial<Focus>)
    return id
  },
}))
