import { isMac, isTauri } from './platform'

async function invoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd)
}

/** Finder Quick Actions ("Dub with VoxStudio", …), macOS desktop app only. */
export const finderActions = {
  available: isTauri && isMac,
  installed: () => invoke<boolean>('finder_actions_status'),
  install: () => invoke<string[]>('finder_actions_install'),
  remove: () => invoke<void>('finder_actions_remove'),
}
