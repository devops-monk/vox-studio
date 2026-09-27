import { useEffect } from 'react'
import { usePrefs } from './store/prefs'

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
