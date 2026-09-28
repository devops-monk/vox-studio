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
  dictation: { shortcut: string; paste: boolean; autoFinish: boolean; language: string }
  setDictation: (patch: Partial<PrefsState['dictation']>) => void
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
      dictation: { shortcut: 'CommandOrControl+Shift+Space', paste: true, autoFinish: true, language: '' },
      setDictation: (patch) => set((s) => ({ dictation: { ...s.dictation, ...patch } })),
      setTheme: (theme) => set({ theme }),
      setEngine: (engine) => set({ engine }),
      setVoice: (engine, voice) => set((s) => ({ voiceByEngine: { ...s.voiceByEngine, [engine]: voice } })),
      finishOnboarding: () => set({ onboardingDone: true }),
      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
    }),
    {
      name: 'voxstudio.prefs',
      // Fill in fields added after a user's prefs were first saved.
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<PrefsState>
        return { ...current, ...s, dictation: { ...current.dictation, ...(s.dictation ?? {}) } }
      },
    },
  ),
)
