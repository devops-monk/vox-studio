import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AudioLines, FolderKanban, Hash, Library, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel } from '@/components/glass'
import { VoiceAvatar } from '@/components/voice-avatar'
import { usePlayer } from '@/lib/audio/player'
import { usePrefs } from '@/lib/store/prefs'
import { timeAgo } from '@/lib/time'
import { voiceLabel } from '@/lib/voice-label'
import { voxd } from '@/lib/voxd/client'
import { useCollection, useCustomVoices, useDesignedVoices, useLibrary, useTags } from '@/lib/voxd/queries'
import { cn } from '@/lib/cn'

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11)

function Section({ icon: Icon, title, count, children }: { icon: typeof Library; title: string; count: number; children: React.ReactNode }) {
  if (!count) return null
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 px-1 text-[12px] font-semibold tracking-wide text-text-3">
        <Icon size={13} /> {title} <span className="font-normal">· {count}</span>
      </h3>
      {children}
    </section>
  )
}

export function CollectionsPage() {
  const tags = useTags().data ?? []
  const [active, setActive] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const current = active && tags.some((t) => t.tag === active) ? active : (tags[0]?.tag ?? null)
  const coll = useCollection(current).data
  const library = useLibrary().data ?? []
  const custom = useCustomVoices().data ?? []
  const designed = useDesignedVoices().data ?? []
  const { current: playing, play, stop } = usePlayer()
  const navigate = useNavigate()
  const { setEngine, setVoice } = usePrefs()

  useEffect(() => setConfirm(false), [current])

  const voices = useMemo(
    () => (coll?.voices ?? []).map((v) => library.find((l) => l.id === v.voice && (l.engine === v.engine || v.engine === 'custom' || l.custom))).filter(Boolean) as typeof library,
    [coll, library],
  )

  const rename = async (from: string, to: string) => {
    setRenaming(null)
    const name = to.trim().toLowerCase()
    if (!name || name === from) return
    try {
      await voxd.renameTag(from, name)
      setActive(name)
      toast.success(`#${from} is now #${name}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl gap-6 px-8 py-8">
      <nav aria-label="Collections" className="w-56 shrink-0 space-y-1">
        <h2 className="px-2 pb-1 font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Collections</h2>
        <p className="px-2 pb-3 text-[12px] text-text-3">Everything that shares a tag — voices, takes and projects together.</p>
        {tags.map((t) => (
          <button
            key={t.tag}
            type="button"
            aria-current={t.tag === current}
            onClick={() => setActive(t.tag)}
            className={cn('flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left transition-colors', t.tag === current ? 'bg-fill-active' : 'hover:bg-fill-hover')}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-[7px] text-white" style={{ background: `hsl(${hue(t.tag)} 65% 52%)` }}>
              <Hash size={12} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.tag}</span>
            <span className="text-[11px] tabular-nums text-text-3">{t.total}</span>
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        {!current ? (
          <GlassPanel className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <Hash size={28} strokeWidth={1.4} className="text-text-3" />
            <div className="text-[14px] font-medium text-text-2">No collections yet</div>
            <div className="max-w-sm text-[12px] text-text-3">
              Tag voices (in Voices), takes (the # button in History) and projects. Everything with the same tag shows up here as a collection — like #podcast or #book-2.
            </div>
          </GlassPanel>
        ) : (
          <>
            <header className="flex items-center gap-3 pt-1">
              <span className="grid size-10 shrink-0 place-items-center rounded-[11px] text-white" style={{ background: `linear-gradient(145deg, hsl(${hue(current)} 70% 58%), hsl(${hue(current)} 70% 38%))` }}>
                <Hash size={18} />
              </span>
              {renaming === current ? (
                <input
                  autoFocus
                  defaultValue={current}
                  aria-label="Tag name"
                  onBlur={(e) => void rename(current, e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' ? (e.target as HTMLInputElement).blur() : e.key === 'Escape' && setRenaming(null))}
                  className="min-w-0 flex-1 rounded-[6px] bg-fill-control px-2 font-[var(--font-display)] text-[22px] font-semibold outline-none"
                />
              ) : (
                <h3 className="min-w-0 flex-1 truncate font-[var(--font-display)] text-[22px] font-semibold tracking-[-0.01em]">#{current}</h3>
              )}
              <Button size="sm" variant="ghost" onClick={() => setRenaming(current)}>
                <Pencil size={12} /> Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onBlur={() => setConfirm(false)}
                onClick={() => (confirm ? void voxd.deleteTag(current).then(() => (toast(`Removed #${current} — the items are kept`), setActive(null))) : setConfirm(true))}
                className={cn(confirm && 'bg-[#ff453a]/12 text-[#ff453a]')}
              >
                <Trash2 size={12} /> {confirm ? 'Remove tag' : 'Remove'}
              </Button>
            </header>

            <Section icon={Library} title="Voices" count={voices.length}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {voices.map((v) => (
                  <GlassPanel key={`${v.engine}|${v.id}`} className="flex items-center gap-2.5 p-3">
                    <VoiceAvatar id={v.id} name={v.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{v.name}</div>
                      <div className="truncate text-[11px] text-text-3">{v.language}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!v.available}
                      title="Use in Studio"
                      onClick={() => (setEngine(v.engine), setVoice(v.engine, v.id), void navigate({ to: '/studio' }))}
                    >
                      <AudioLines size={12} />
                    </Button>
                  </GlassPanel>
                ))}
              </div>
            </Section>

            <Section icon={AudioLines} title="Takes" count={coll?.takes.length ?? 0}>
              <ul className="glass divide-y-[0.5px] divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-lg)]">
                {coll?.takes.map((t) => {
                  const on = playing === t.id
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                      <button
                        type="button"
                        aria-label={on ? 'Pause' : 'Play'}
                        onClick={() => (on ? stop() : void play(t.id, voxd.audioUrl(t)))}
                        className={cn('grid size-7 shrink-0 place-items-center rounded-full', on ? 'bg-accent text-white' : 'bg-fill-control hover:bg-fill-active')}
                      >
                        {on ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-px" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">{t.text}</div>
                        <div className="truncate text-[11px] text-text-3">
                          {voiceLabel(t, custom, designed)} · {t.duration_s.toFixed(1)} s · {timeAgo(t.created_at)}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Section>

            <Section icon={FolderKanban} title="Projects" count={coll?.projects.length ?? 0}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {coll?.projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void navigate({ to: '/projects' })}
                    className="rounded-[var(--radius-lg)] p-3 text-left text-white shadow-[0_6px_18px_rgba(0,0,0,0.15)] transition-transform hover:-translate-y-0.5"
                    style={{ background: `linear-gradient(145deg, ${p.color}, color-mix(in srgb, ${p.color} 55%, black))` }}
                  >
                    <div className="truncate text-[14px] font-semibold">{p.name}</div>
                    <div className="mt-3 text-[11px] opacity-85">
                      {p.item_count} item{p.item_count === 1 ? '' : 's'}
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
