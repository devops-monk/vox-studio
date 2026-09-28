import { isTauri } from './platform'

/** Native folder picker in the app; a typed path in the browser (dev). */
export async function pickFolder(title: string): Promise<string | null> {
  if (!isTauri) return window.prompt(`${title} — enter an absolute folder path`)?.trim() || null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ directory: true, title })
  return typeof result === 'string' ? result : null
}

/** Native multi-file picker; returns absolute paths. */
export async function pickFiles(title: string, extensions: string[]): Promise<string[]> {
  if (!isTauri) {
    const typed = window.prompt(`${title} — absolute paths, separated by ;`)
    return typed ? typed.split(';').map((s) => s.trim()).filter(Boolean) : []
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ multiple: true, title, filters: [{ name: 'Media', extensions }] })
  return Array.isArray(result) ? result : result ? [result] : []
}
