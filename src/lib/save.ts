import { toast } from 'sonner'
import { isTauri } from './platform'
import { voxd } from './voxd/client'
import type { Take } from './voxd/types'

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'take'

/** Save a take as a WAV file: native Save dialog in the app, a download in the browser. */
export async function saveTake(take: Take) {
  const name = `${slug(take.text)}.wav`
  if (!isTauri) {
    const a = document.createElement('a')
    a.href = voxd.audioUrl(take)
    a.download = name
    a.click()
    return
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: name, filters: [{ name: 'WAV audio', extensions: ['wav'] }] })
  if (!path) return
  try {
    await voxd.exportTake(take.id, path, true) // the dialog already asked about replacing
    toast.success('Saved', { description: path.split(/[\\/]/).pop() })
  } catch (e) {
    toast.error('Couldn’t save', { description: (e as Error).message })
  }
}
