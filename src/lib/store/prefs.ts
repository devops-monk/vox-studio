import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemePref = 'system' | 'light' | 'dark'

interface PrefsState {
  theme: ThemePref
  inspectorOpen: boolean
  /** Engine used by quick speech surfaces (Try a voice). */
  engine: string
  /** Voice last picked per engine. */
  voiceByEngine: Record<string, string>
  onboardingDone: boolean
  setTheme: (theme: ThemePref) => void
  setEngine: (engine: string) => void
  setVoice: (engine: string, voice: string) => void
  finishOnboarding: () => void
  toggleInspector: () => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      inspectorOpen: false,
      engine: 'system',
      voiceByEngine: {},
      onboardingDone: false,
      setTheme: (theme) => set({ theme }),
      setEngine: (engine) => set({ engine }),
      setVoice: (engine, voice) => set((s) => ({ voiceByEngine: { ...s.voiceByEngine, [engine]: voice } })),
      finishOnboarding: () => set({ onboardingDone: true }),
      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
    }),
    { name: 'voxstudio.prefs' },
  ),
)
