import { isTauri } from './platform'

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export const QUICK_DEFAULT_SHORTCUT = 'Control+Alt+S'
export const SELECTION_DEFAULT_SHORTCUT = 'Control+Alt+R'

/** Quick Speak panel (desktop only). */
export const quick = {
  available: isTauri,
  toggle: () => invoke<void>('quick_toggle'),
  hide: () => invoke<void>('quick_hide'),
  resize: (height: number) => invoke<void>('quick_resize', { height }),
  setShortcut: (accelerator: string) => invoke<void>('quick_set_shortcut', { accelerator }),
  setSelectionShortcut: (accelerator: string) => invoke<void>('quick_set_selection_shortcut', { accelerator }),
  /** Text grabbed by Speak Selection (or a notice), waiting for the panel. */
  takePending: () => invoke<{ text: string | null; notice: string | null } | null>('quick_take_pending'),
  speakSelection: () => invoke<void>('speak_selection'),
  /** Hand a voxstudio:// link to the main window. */
  openLink: (url: string) => invoke<void>('open_link', { url }),
}
