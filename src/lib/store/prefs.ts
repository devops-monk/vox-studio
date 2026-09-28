import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemePref = 'system' | 'light' | 'dark'
export type GlassPref = 'clear' | 'balanced' | 'frosted' | 'solid'
export type TextSizePref = 'small' | 'default' | 'large'

export const ACCENTS = [
  { id: 'blue', label: 'Blue', color: '#0a84ff' },
  { id: 'purple', label: 'Purple', color: '#bf5af2' },
  { id: 'pink', label: 'Pink', color: '#ff375f' },
  { id: 'red', label: 'Red', color: '#ff453a' },
  { id: 'orange', label: 'Orange', color: '#ff9f0a' },
  { id: 'green', label: 'Green', color: '#30d158' },
  { id: 'teal', label: 'Teal', color: '#40c8e0' },
  { id: 'graphite', label: 'Graphite', color: '#8e8e93' },
] as const
export type AccentPref = (typeof ACCENTS)[number]['id']

interface PrefsState {
  theme: ThemePref
  accent: AccentPref
  glass: GlassPref
  textSize: TextSizePref
  /** Page shown when the app opens. */
  startPage: string
  /** Look for a new version once a day at launch. */
  autoUpdate: boolean
  inspectorOpen: boolean
  /** Engine used by quick speech surfaces (Try a voice). */
  engine: string
  /** Voice last picked per engine. */
  voiceByEngine: Record<string, string>
  onboardingDone: boolean
  dictation: { shortcut: string; paste: boolean; autoFinish: boolean; language: string }
  setDictation: (patch: Partial<PrefsState['dictation']>) => void
  setTheme: (theme: ThemePref) => void
  setAppearance: (patch: Partial<Pick<PrefsState, 'accent' | 'glass' | 'textSize' | 'startPage' | 'autoUpdate'>>) => void
  setEngine: (engine: string) => void
  setVoice: (engine: string, voice: string) => void
  finishOnboarding: () => void
  toggleInspector: () => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      accent: 'blue',
      glass: 'balanced',
      textSize: 'default',
      startPage: '/',
      autoUpdate: true,
      inspectorOpen: false,
      engine: 'system',
      voiceByEngine: {},
      onboardingDone: false,
      dictation: { shortcut: 'CommandOrControl+Shift+Space', paste: true, autoFinish: true, language: '' },
      setDictation: (patch) => set((s) => ({ dictation: { ...s.dictation, ...patch } })),
      setTheme: (theme) => set({ theme }),
      setAppearance: (patch) => set(patch),
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
