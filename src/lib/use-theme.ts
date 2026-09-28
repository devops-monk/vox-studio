import { useEffect } from 'react'
import { ACCENTS, usePrefs } from './store/prefs'

/** Applies the resolved theme to <html data-theme> and keeps it in sync with the OS. */
export function useApplyTheme() {
  const theme = usePrefs((s) => s.theme)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

/** Accent colour, glass material and text size from Settings → Appearance. */
export function useApplyAppearance() {
  const { accent, glass, textSize } = usePrefs()
  useEffect(() => {
    const root = document.documentElement
    const color = ACCENTS.find((a) => a.id === accent)?.color ?? ACCENTS[0].color
    root.style.setProperty('--accent', color)
    root.dataset.glass = glass
    root.dataset.textSize = textSize
  }, [accent, glass, textSize])
}
