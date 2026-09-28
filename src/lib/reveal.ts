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
