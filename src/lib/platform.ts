/** True when running inside the Tauri webview (vs. a plain browser during `npm run dev`). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
