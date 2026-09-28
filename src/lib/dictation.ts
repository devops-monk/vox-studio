import { isTauri, isMac } from './platform'

export interface DictationStatus {
  shortcut: string
  accessibility: boolean
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export const dictation = {
  available: isTauri,
  toggle: () => invoke<void>('dictation_toggle'),
  hide: () => invoke<void>('dictation_hide'),
  insert: (text: string, paste: boolean) => invoke<{ pasted: boolean }>('dictation_insert', { text, paste }),
  setShortcut: (accelerator: string) => invoke<void>('dictation_set_shortcut', { accelerator }),
  status: () => invoke<DictationStatus>('dictation_status'),
  openAccessibility: () => invoke<void>('dictation_open_accessibility'),
  log: (message: string) => invoke<void>('client_log', { source: 'dictation', message }).catch(() => {}),
}

const SYMBOLS: Record<string, string> = isMac
  ? { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Space: 'Space' }
  : { CommandOrControl: 'Ctrl', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Space: 'Space' }

/** "CommandOrControl+Shift+Space" → "⇧⌘Space" on macOS. */
export function prettyShortcut(accelerator: string) {
  const parts = accelerator.split('+').map((p) => SYMBOLS[p] ?? (p.length === 1 ? p.toUpperCase() : p))
  if (!isMac) return parts.join('+')
  const order = ['⌃', '⌥', '⇧', '⌘']
  const mods = parts.filter((p) => order.includes(p)).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return mods.join('') + parts.filter((p) => !order.includes(p)).join('')
}

/** Turn a keydown into an accelerator string, or null if it's only modifiers. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return null
  const mods = [e.metaKey || e.ctrlKey ? 'CommandOrControl' : null, e.altKey ? 'Alt' : null, e.shiftKey ? 'Shift' : null].filter(Boolean)
  if (!mods.length) return null // a global shortcut needs at least one modifier
  const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.code
  return [...mods, key].join('+')
}
