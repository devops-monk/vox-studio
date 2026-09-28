import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { usePrefs } from '@/lib/store/prefs'

/** In-app keyboard shortcuts (⌘ on macOS, Ctrl elsewhere). Listed in Settings → Shortcuts. */
export const APP_SHORTCUTS: { keys: string; label: string; to?: string }[] = [
  { keys: '⌘K', label: 'Search and jump anywhere' },
  { keys: '⌘1', label: 'Studio', to: '/studio' },
  { keys: '⌘2', label: 'Clone', to: '/clone' },
  { keys: '⌘3', label: 'Design', to: '/design' },
  { keys: '⌘4', label: 'Dub', to: '/dub' },
  { keys: '⌘5', label: 'Stories', to: '/stories' },
  { keys: '⌘6', label: 'Audiobook', to: '/audiobook' },
  { keys: '⌘7', label: 'Transcribe', to: '/transcribe' },
  { keys: '⌘Y', label: 'History', to: '/history' },
  { keys: '⌘,', label: 'Settings', to: '/settings' },
  { keys: '⌘⌥I', label: 'Show or hide recent takes' },
  { keys: '⌘↩', label: 'Generate (in Studio and Try a voice)' },
  { keys: 'Esc', label: 'Close a panel or popover' },
]

const BY_KEY: Record<string, string> = Object.fromEntries(
  APP_SHORTCUTS.filter((s) => s.to && s.keys.length === 2).map((s) => [s.keys[1].toLowerCase(), s.to!]),
)

export function useAppShortcuts() {
  const navigate = useNavigate()
  const toggleInspector = usePrefs((s) => s.toggleInspector)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return
      if (e.altKey && e.code === 'KeyI') {
        e.preventDefault()
        toggleInspector()
        return
      }
      const to = !e.altKey && BY_KEY[e.key.toLowerCase()]
      if (to) {
        e.preventDefault()
        void navigate({ to })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, toggleInspector])
}

/** Open the page chosen in Settings → General once, at launch. */
let startApplied = false
export function useStartPage() {
  const navigate = useNavigate()
  useEffect(() => {
    if (startApplied) return
    startApplied = true
    const start = usePrefs.getState().startPage
    if (start && start !== '/' && (location.hash === '' || location.hash === '#/')) void navigate({ to: start })
  }, [navigate])
}
