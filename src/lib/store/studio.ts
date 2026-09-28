import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface StudioState {
  text: string
  speed: number
  emotion: number
  /** Interpret [pause], [slow]…, *emphasis* and {written|spoken} in the script. */
  markup: boolean
  setMarkup: (markup: boolean) => void
  setText: (text: string) => void
  setSpeed: (speed: number) => void
  setEmotion: (emotion: number) => void
}

/** The Studio draft survives restarts, like a document. */
export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      text: '',
      speed: 1,
      emotion: 0.5,
      markup: true,
      setMarkup: (markup) => set({ markup }),
      setText: (text) => set({ text }),
      setSpeed: (speed) => set({ speed }),
      setEmotion: (emotion) => set({ emotion }),
    }),
    { name: 'voxstudio.studio' },
  ),
)
