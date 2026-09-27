import { create } from 'zustand'
import { isTauri } from '@/lib/platform'
import type { VoxdState } from './types'

interface Store {
  state: VoxdState
  logs: string[]
  restart: () => Promise<void>
}

const initial: VoxdState = { phase: 'starting', detail: null, url: null, token: '', restarts: 0 }

export const useVoxd = create<Store>(() => ({
  state: initial,
  logs: [],
  restart: async () => {},
}))

let started = false

/** Connects the store to the shell (Tauri) or, in a plain browser, polls a manually started voxd. */
export function connectVoxd() {
  if (started) return
  started = true
  if (isTauri) void connectShell()
  else connectBrowser()
}

async function connectShell() {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')])
  useVoxd.setState({ restart: () => invoke('voxd_restart') })
  await listen<VoxdState>('voxd://state', (e) => useVoxd.setState({ state: e.payload }))
  await listen<string>('voxd://log', (e) => useVoxd.setState((s) => ({ logs: [...s.logs.slice(-499), e.payload] })))
  const [state, logs] = await Promise.all([invoke<VoxdState>('voxd_state'), invoke<string[]>('voxd_logs')])
  useVoxd.setState({ state, logs })
}

/** `npm run dev` in a browser: run `uv run python -m voxd` yourself (no token). */
function connectBrowser() {
  const url = import.meta.env.VITE_VOXD_URL ?? 'http://127.0.0.1:4870'
  const token = import.meta.env.VITE_VOXD_TOKEN ?? ''
  const poll = async () => {
    try {
      const res = await fetch(`${url}/v1/status`)
      const body = (await res.json()) as { phase: VoxdState['phase']; detail: string | null }
      useVoxd.setState({ state: { phase: body.phase, detail: body.detail, url, token, restarts: 0 } })
    } catch {
      useVoxd.setState({
        state: { phase: 'error', detail: `Can't reach voxd at ${url}. Start it with: cd voxd && uv run python -m voxd`, url: null, token, restarts: 0 },
      })
    }
  }
  useVoxd.setState({ restart: poll })
  void poll()
  setInterval(() => {
    if (useVoxd.getState().state.phase !== 'ready') void poll()
  }, 1500)
}
