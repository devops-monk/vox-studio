import { toast } from 'sonner'
import { isTauri } from './platform'

/** Show a file in Finder (desktop app only). */
export async function revealInFinder(path: string) {
  if (!isTauri) {
    toast('Reveal in Finder works in the desktop app', { description: path })
    return
  }
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(path)
  } catch (e) {
    toast.error('Couldn’t show the file', { description: String(e) })
  }
}

/** Open a web page in the default browser (the desktop webview can't navigate away). */
export async function openExternal(url: string) {
  if (!isTauri) {
    window.open(url, '_blank', 'noopener')
    return
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch (e) {
    toast.error('Couldn’t open the page', { description: String(e) })
  }
}
