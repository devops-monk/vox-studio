import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { usePalette } from './command-palette'
import { useActivityPanel } from './activity'
import { ALL_NAV_ITEMS } from './nav'
import { usePlayer } from '@/lib/audio/player'
import { isTauri } from '@/lib/platform'
import { usePrefs } from '@/lib/store/prefs'
import { useStudio } from '@/lib/store/studio'
import { maybeCheckOnLaunch, checkForUpdates } from '@/lib/updater'
import { voxd } from '@/lib/voxd/client'

const PAGES = new Set(ALL_NAV_ITEMS.map((i) => i.path))
const MAX_LINK_TEXT = 2000

const MENU_ROUTES: Record<string, string> = {
  settings: '/settings',
  'new-script': '/studio',
  'clone-voice': '/clone',
  'transcribe-file': '/transcribe',
  'dub-video': '/dub',
  'import-book': '/audiobook',
}

type Navigate = ReturnType<typeof useNavigate>

function onMenu(id: string, navigate: Navigate) {
  if (id.startsWith('go:')) return void navigate({ to: id.slice(3) })
  if (id in MENU_ROUTES) {
    if (id === 'new-script') useStudio.getState().setText('')
    return void navigate({ to: MENU_ROUTES[id] })
  }
  if (id === 'updates') return void checkForUpdates()
  if (id === 'palette') return usePalette.getState().setOpen(true)
  if (id === 'inspector') return usePrefs.getState().toggleInspector()
  if (id === 'activity') return useActivityPanel.getState().setOpen(true)
}

/**
 * `voxstudio://` links, from the browser, Shortcuts, scripts or `open` in Terminal:
 *
 *   voxstudio://open/<page>               e.g. voxstudio://open/transcribe
 *   voxstudio://studio?text=…             open Studio with a script
 *   voxstudio://speak?text=…&voice=…      say it right away with the quick voice (or the given one)
 */
export async function handleLink(raw: string, navigate: Navigate) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return
  }
  const action = url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0]
  const rest = (url.hostname ? url.pathname : url.pathname.replace(/^\/+[^/]+/, '')).replace(/^\/+/, '')
  const text = (url.searchParams.get('text') ?? '').slice(0, MAX_LINK_TEXT)

  if (action === 'open') {
    const page = `/${rest}`.replace(/\/+$/, '') || '/'
    return void navigate({ to: PAGES.has(page) ? page : '/' })
  }
  if (action === 'studio') {
    if (text) useStudio.getState().setText(text)
    return void navigate({ to: '/studio' })
  }
  if (action === 'speak' && text.trim()) {
    const prefs = usePrefs.getState()
    const engine = url.searchParams.get('engine') ?? prefs.engine
    const voice = url.searchParams.get('voice') ?? prefs.voiceByEngine[engine] ?? (await voxd.voices(engine).catch(() => []))[0]?.id
    const id = toast.loading('Speaking…')
    try {
      const take = await voxd.speak({ text, voice: voice ?? '', engine, speed: 1 })
      toast.dismiss(id)
      void usePlayer.getState().play(take.id, voxd.audioUrl(take))
    } catch (e) {
      toast.error('Couldn’t speak that link', { id, description: (e as Error).message })
    }
    return
  }
  toast.error('Unknown VoxStudio link', { description: raw.slice(0, 120) })
}

/** Menu bar, deep links and update checks — the parts only the desktop app has. */
export function useDesktopIntegration() {
  const navigate = useNavigate()
  const autoUpdate = usePrefs((s) => s.autoUpdate)

  useEffect(() => {
    if (!isTauri) return
    let disposed = false
    const unlisten: (() => void)[] = []
    void (async () => {
      const [{ listen }, { invoke }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core')])
      // The shell queues links; draining the queue (rather than using the event payload) handles
      // links that launched the app before we were listening, and never handles one twice.
      const drain = async () => {
        for (const link of await invoke<string[]>('take_pending_links')) void handleLink(link, navigate)
      }
      const offMenu = await listen<string>('app://menu', (e) => onMenu(e.payload, navigate))
      const offLink = await listen('app://deep-link', () => void drain())
      if (disposed) return void (offMenu(), offLink())
      unlisten.push(offMenu, offLink)
      await drain()
    })()
    return () => {
      disposed = true
      unlisten.forEach((f) => f())
    }
  }, [navigate])

  useEffect(() => maybeCheckOnLaunch(autoUpdate), [autoUpdate])
}
