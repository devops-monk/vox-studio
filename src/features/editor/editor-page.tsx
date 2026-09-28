import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2, Minus, Pause, Play, Plus, Redo2, Save, Scissors, SkipBack, Trash2, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, Kbd, Slider, Switch } from '@/components/glass'
import { useFocus } from '@/lib/store/focus'
import { voxd } from '@/lib/voxd/client'
import { useTakes } from '@/lib/voxd/queries'
import type { Take } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { layout, newClipId, useEditor, type Clip } from './editor-store'
import { loadSource, PEAKS_PER_SECOND, Preview, type Source } from './preview'

const MIN_CLIP_S = 0.05
const TRACK_H = 88
const hue = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`

function useSources(ids: string[]) {
  const [loaded, setLoaded] = useState<Record<string, Source>>({})
  const key = [...new Set(ids)].sort().join(',')
  useEffect(() => {
    let alive = true
    for (const id of key ? key.split(',') : []) {
      loadSource(id).then(
        (s) => alive && setLoaded((m) => (m[id] ? m : { ...m, [id]: s })),
        () => toast.error('A take in this edit couldn’t be loaded — it may have been deleted'),
      )
    }
    return () => {
      alive = false
    }
  }, [key])
  return loaded
}

/** The waveform of one clip's slice of its take, drawn on a canvas. */
function ClipWave({ source, clip, width, color }: { source?: Source; clip: Clip; width: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !source || width < 2) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor((TRACK_H - 26) * dpr)
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)
    g.fillStyle = color
    const h = TRACK_H - 26
    const a = clip.start * PEAKS_PER_SECOND
    const perPx = ((clip.end - clip.start) * PEAKS_PER_SECOND) / width
    const gain = 10 ** (clip.gainDb / 20)
    for (let x = 0; x < width; x += 2) {
      let peak = 0
      for (let i = Math.floor(a + x * perPx), end = Math.floor(a + (x + 2) * perPx); i <= end && i < source.peaks.length; i++) peak = Math.max(peak, source.peaks[i])
      const bar = Math.max(1, Math.min(1, peak * gain * 1.6) * (h - 4))
      g.fillRect(x, (h - bar) / 2, 1.4, bar)
    }
  }, [source, clip.start, clip.end, clip.gainDb, width, color])
  return <canvas ref={ref} style={{ width, height: TRACK_H - 26 }} className="block" />
}

function AddTake({ onAdd, onClose }: { onAdd: (t: Take) => void; onClose: () => void }) {
  const takes = useTakes(40).data ?? []
  const [q, setQ] = useState('')
  const hits = takes.filter((t) => !q || t.text.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="glass-pop absolute top-full right-0 z-30 mt-2 w-96 overflow-hidden rounded-[var(--radius-lg)] animate-[pop-in_200ms_var(--ease-spring)_both]">
      <div className="flex items-center gap-2 border-b-[0.5px] border-hairline p-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your takes" aria-label="Search takes" className="h-7 min-w-0 flex-1 rounded-[6px] bg-fill-control px-2 text-[12px] outline-none" />
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X size={13} />
        </Button>
      </div>
      <ul className="max-h-72 overflow-y-auto py-1">
        {hits.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => onAdd(t)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-fill-hover">
              <span className="size-2 shrink-0 rounded-full" style={{ background: `hsl(${hue(t.id)} 75% 60%)` }} />
              <span className="min-w-0 flex-1 truncate text-[12px]">{t.text || 'Untitled'}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-text-3">{t.duration_s.toFixed(1)} s</span>
            </button>
          </li>
        ))}
        {!hits.length && <li className="px-3 py-3 text-[12px] text-text-3">No takes found.</li>}
      </ul>
    </div>
  )
}

export function EditorPage() {
  const { clips, mix, title, selected, past, future, edit, undo, redo, select, setTitle, reset } = useEditor()
  const sources = useSources(clips.map((c) => c.takeId))
  const takes = useTakes(200).data ?? []
  const navigate = useNavigate()
  const preview = useRef(new Preview()).current
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null) // px per second; null = fit
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drag, setDrag] = useState<{ id: string; target: number } | null>(null)
  const lane = useRef<HTMLDivElement>(null)
  const [laneWidth, setLaneWidth] = useState(800)

  const { positions, total } = useMemo(() => layout(clips, mix), [clips, mix])
  const pps = zoom ?? Math.max(20, (laneWidth - 24) / Math.max(total, 1))
  const sel = clips.find((c) => c.id === selected) ?? null
  const takeOf = (id: string) => takes.find((t) => t.id === id)

  const addTake = useCallback(
    (t: Take, atEnd = true) => {
      const clip: Clip = { id: newClipId(), takeId: t.id, start: 0, end: t.duration_s, gainDb: 0 }
      edit((d) => ({ ...d, clips: atEnd ? [...d.clips, clip] : [clip, ...d.clips] }))
      select(clip.id)
      if (!useEditor.getState().title) setTitle(`Edited · ${t.text.slice(0, 60)}`)
    },
    [edit, select, setTitle],
  )

  // "Edit" from History, Studio or the inspector.
  useEffect(() => {
    const id = useFocus.getState().take('edit')
    if (!id) return
    voxd
      .takes(200)
      .then((list) => {
        const t = list.find((x) => x.id === id)
        if (t) addTake(t)
      })
      .catch(() => {})
  }, [addTake])

  useEffect(() => {
    const el = lane.current
    if (!el) return
    const ro = new ResizeObserver(() => setLaneWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Playhead animation while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      setPlayhead(preview.position())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, preview])
  useEffect(() => {
    preview.onEnd = () => (setPlaying(false), setPlayhead(0), preview.seek(0))
    return () => preview.stop()
  }, [preview])

  const togglePlay = useCallback(async () => {
    if (preview.playing) {
      preview.stop()
      setPlaying(false)
      setPlayhead(preview.position())
      return
    }
    if (!clips.length) return
    await preview.play(clips, mix, playhead >= total - 0.01 ? 0 : playhead)
    setPlaying(true)
  }, [clips, mix, playhead, total, preview])

  // Restart playback from the same spot when the edit changes mid-play.
  useEffect(() => {
    if (preview.playing) void preview.play(clips, mix, preview.position())
  }, [clips, mix, preview])

  const seek = (t: number) => {
    const at = Math.max(0, Math.min(total, t))
    setPlayhead(at)
    preview.seek(at)
    if (preview.playing) void preview.play(clips, mix, at)
  }

  const split = useCallback(() => {
    const i = clips.findIndex((c, k) => playhead > positions[k] + MIN_CLIP_S && playhead < positions[k] + (c.end - c.start) - MIN_CLIP_S)
    if (i < 0) return toast('Move the playhead inside a clip to split it')
    const c = clips[i]
    const cut = c.start + (playhead - positions[i])
    const right: Clip = { ...c, id: newClipId(), start: cut }
    edit((d) => ({ ...d, clips: [...d.clips.slice(0, i), { ...c, end: cut }, right, ...d.clips.slice(i + 1)] }))
    select(right.id)
  }, [clips, playhead, positions, edit, select])

  const remove = useCallback(() => {
    if (!selected) return
    edit((d) => ({ ...d, clips: d.clips.filter((c) => c.id !== selected) }))
    select(null)
  }, [selected, edit, select])

  const patchClip = (id: string, patch: Partial<Clip>, merge = false) => edit((d) => ({ ...d, clips: d.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), merge)
  const patchMix = (patch: Partial<typeof mix>, merge = true) => edit((d) => ({ ...d, mix: { ...d.mix, ...patch } }), merge)

  // Keyboard: space play, S split, ⌫ delete, ⌘Z / ⇧⌘Z, ← → nudge, Home.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if (mod) return
      if (e.key === ' ') (e.preventDefault(), void togglePlay())
      else if (e.key.toLowerCase() === 's') (e.preventDefault(), split())
      else if (e.key === 'Backspace' || e.key === 'Delete') (e.preventDefault(), remove())
      else if (e.key === 'ArrowLeft') (e.preventDefault(), seek(playhead - (e.shiftKey ? 1 : 0.1)))
      else if (e.key === 'ArrowRight') (e.preventDefault(), seek(playhead + (e.shiftKey ? 1 : 0.1)))
      else if (e.key === 'Home') (e.preventDefault(), seek(0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Trim by dragging a clip's edge.
  const startTrim = (e: React.PointerEvent, clip: Clip, side: 'start' | 'end') => {
    e.stopPropagation()
    e.preventDefault()
    select(clip.id)
    const x0 = e.clientX
    const orig = { ...clip }
    const max = takeOf(clip.takeId)?.duration_s ?? sources[clip.takeId]?.buffer.duration ?? clip.end
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps
      if (side === 'start') patchClip(clip.id, { start: Math.min(Math.max(0, orig.start + dt), orig.end - MIN_CLIP_S) }, true)
      else patchClip(clip.id, { end: Math.max(Math.min(max, orig.end + dt), orig.start + MIN_CLIP_S) }, true)
    }
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up))
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Reorder by dragging a clip's body; a click just selects it (and seeks there).
  const startMove = (e: React.PointerEvent, clip: Clip, index: number) => {
    select(clip.id)
    const x0 = e.clientX
    let moved = false
    const laneLeft = lane.current!.getBoundingClientRect().left - lane.current!.scrollLeft + 12
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 5) return
      moved = true
      const t = (ev.clientX - laneLeft) / pps
      let target = clips.length
      for (let k = 0; k < clips.length; k++) if (t < positions[k] + (clips[k].end - clips[k].start) / 2) (target = k), (k = clips.length)
      setDrag({ id: clip.id, target })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag((d) => {
        if (moved && d) {
          const to = d.target > index ? d.target - 1 : d.target
          if (to !== index)
            edit((doc) => {
              const next = doc.clips.filter((c) => c.id !== clip.id)
              next.splice(to, 0, clip)
              return { ...doc, clips: next }
            })
        } else if (!moved) seek((ev.clientX - laneLeft) / pps)
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const save = async () => {
    setSaving(true)
    try {
      const take = await voxd.editTakes({
        clips: clips.map((c) => ({ take_id: c.takeId, start: c.start, end: c.end, gain_db: c.gainDb })),
        gap_s: mix.gapS,
        crossfade_ms: mix.crossfadeMs,
        fade_in_s: mix.fadeInS,
        fade_out_s: mix.fadeOutS,
        gain_db: mix.gainDb,
        normalize: mix.normalize,
        title: title.trim() || null,
      })
      toast.success('Saved as a new take', { description: `${take.duration_s.toFixed(1)} s · ${take.text}`, action: { label: 'History', onClick: () => void navigate({ to: '/history' }) } })
    } catch (e) {
      toast.error('Couldn’t save the edit', { description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const ticks = useMemo(() => {
    const step = [0.5, 1, 2, 5, 10, 30, 60].find((s) => s * pps >= 70) ?? 120
    return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step)
  }, [pps, total])

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-8 py-8">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Editor</h2>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled edit"
            aria-label="Edit title"
            className="-ml-1 w-full max-w-xl rounded-[6px] bg-transparent px-1 text-[14px] text-text-2 outline-none hover:bg-fill-hover focus:bg-fill-control"
          />
        </div>
        <div className="relative flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={!clips.length} onClick={() => (preview.stop(), setPlaying(false), setPlayhead(0), reset())}>
            New
          </Button>
          <Button size="sm" onClick={() => setAdding((a) => !a)}>
            <Plus size={12} /> Add take
          </Button>
          {adding && <AddTake onAdd={(t) => (addTake(t), setAdding(false))} onClose={() => setAdding(false)} />}
          <Button size="sm" variant="primary" disabled={!clips.length || saving} onClick={() => void save()}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save as take
          </Button>
        </div>
      </header>

      <GlassPanel className="space-y-3 p-4">
        {/* Transport */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Back to start" onClick={() => seek(0)}>
            <SkipBack size={14} />
          </Button>
          <button
            type="button"
            onClick={() => void togglePlay()}
            disabled={!clips.length}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid size-9 place-items-center rounded-full bg-accent text-white shadow-[0_4px_14px_color-mix(in_srgb,var(--accent)_40%,transparent)] transition-transform active:scale-95 disabled:opacity-40"
          >
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </button>
          <div className="w-36 font-[var(--font-mono)] text-[13px] tabular-nums">
            {clock(playhead)} <span className="text-text-3">/ {clock(total)}</span>
          </div>
          <div className="mx-1 h-5 w-px bg-[var(--hairline)]" />
          <Button size="sm" variant="ghost" disabled={!clips.length} onClick={split} title="Split at playhead (S)">
            <Scissors size={12} /> Split
          </Button>
          <Button size="sm" variant="ghost" disabled={!sel} onClick={remove} title="Delete clip (⌫)">
            <Trash2 size={12} /> Delete
          </Button>
          <Button variant="ghost" size="icon" aria-label="Undo" disabled={!past.length} onClick={undo} title="Undo (⌘Z)">
            <Undo2 size={14} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Redo" disabled={!future.length} onClick={redo} title="Redo (⇧⌘Z)">
            <Redo2 size={14} />
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom(Math.max(10, pps / 1.5))}>
              <Minus size={13} />
            </Button>
            <button type="button" onClick={() => setZoom(null)} className={cn('rounded-[6px] px-2 py-0.5 text-[11px]', zoom === null ? 'bg-fill-active' : 'text-text-3 hover:bg-fill-hover')}>
              Fit
            </button>
            <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom(Math.min(2000, pps * 1.5))}>
              <Plus size={13} />
            </Button>
          </div>
        </div>

        {/* Timeline */}
        <div ref={lane} className="relative overflow-x-auto overflow-y-hidden rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--fill-control)_70%,transparent)]">
          {clips.length ? (
            <div className="relative px-3 pt-6 pb-3" style={{ width: total * pps + 24, minWidth: '100%' }}>
              <div className="absolute inset-x-3 top-0 h-5 cursor-pointer" onPointerDown={(e) => seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / pps)}>
                {ticks.map((t) => (
                  <span key={t} className="absolute top-1 border-l-[0.5px] border-[var(--hairline-strong)] pl-1 font-[var(--font-mono)] text-[9px] text-text-3" style={{ left: t * pps }}>
                    {t >= 60 ? clock(t).replace(/\.\d+$/, '') : `${t}s`}
                  </span>
                ))}
              </div>
              <div className="relative" style={{ height: TRACK_H }}>
                {clips.map((c, i) => {
                  const w = Math.max(6, (c.end - c.start) * pps)
                  const h = hue(c.takeId)
                  const isSel = c.id === selected
                  const t = takeOf(c.takeId)
                  return (
                    <div
                      key={c.id}
                      onPointerDown={(e) => startMove(e, c, i)}
                      className={cn(
                        'group absolute top-0 cursor-grab overflow-hidden rounded-[10px] border transition-[box-shadow,opacity] active:cursor-grabbing',
                        isSel ? 'z-10 shadow-[0_0_0_2px_var(--accent),0_6px_18px_rgba(0,0,0,0.25)]' : 'shadow-[0_2px_6px_rgba(0,0,0,0.12)]',
                        drag?.id === c.id && 'opacity-50',
                      )}
                      style={{ left: positions[i] * pps, width: w, height: TRACK_H, background: `hsl(${h} 70% 55% / 0.16)`, borderColor: `hsl(${h} 70% 55% / 0.45)` }}
                    >
                      <div className="flex h-[22px] items-center gap-1.5 px-2 text-[10px] font-medium" style={{ color: `hsl(${h} 60% 45%)` }}>
                        <span className="truncate">{t?.text || 'Take'}</span>
                        {c.gainDb !== 0 && <span className="shrink-0 tabular-nums opacity-75">{c.gainDb > 0 ? '+' : ''}{c.gainDb.toFixed(1)} dB</span>}
                      </div>
                      <ClipWave source={sources[c.takeId]} clip={c} width={w} color={`hsl(${h} 70% 55%)`} />
                      {(['start', 'end'] as const).map((side) => (
                        <div
                          key={side}
                          onPointerDown={(e) => startTrim(e, c, side)}
                          aria-label={`Trim ${side}`}
                          className={cn('absolute inset-y-0 w-2.5 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100', side === 'start' ? 'left-0 rounded-l-[10px]' : 'right-0 rounded-r-[10px]', isSel && 'opacity-100')}
                          style={{ background: `hsl(${h} 70% 55% / 0.55)` }}
                        />
                      ))}
                    </div>
                  )
                })}
                {drag && (
                  <div className="absolute -top-1 -bottom-1 z-20 w-0.5 rounded-full bg-accent" style={{ left: (drag.target < clips.length ? positions[drag.target] : total) * pps - 1 }} />
                )}
              </div>
              <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-[#ff453a]" style={{ left: 12 + playhead * pps }}>
                <div className="absolute -top-0.5 -left-[4px] size-[9px] rotate-45 rounded-[2px] bg-[#ff453a]" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Scissors size={26} strokeWidth={1.4} className="text-text-3" />
              <div className="text-[14px] font-medium text-text-2">Nothing to edit yet</div>
              <div className="max-w-sm text-[12px] text-text-3">Add a take, or use Edit on any take in History. Combine several takes into one, cut out mistakes and polish the ends.</div>
              <Button size="sm" className="mt-1" onClick={() => setAdding(true)}>
                <Plus size={12} /> Add take
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-3">
          <span><Kbd>Space</Kbd> play</span>
          <span><Kbd>S</Kbd> split at playhead</span>
          <span><Kbd>⌫</Kbd> delete clip</span>
          <span><Kbd>←</Kbd><Kbd>→</Kbd> nudge</span>
          <span>Drag a clip to reorder, its edges to trim</span>
        </div>
      </GlassPanel>

      <div className="grid gap-4 md:grid-cols-2">
        <GlassPanel className="space-y-4 p-5">
          <h3 className="text-[13px] font-semibold">Clip</h3>
          {sel ? (
            <>
              <div className="truncate text-[12px] text-text-3">{takeOf(sel.takeId)?.text}</div>
              <Slider label="Clip gain" value={sel.gainDb} min={-20} max={12} step={0.5} onChange={(v) => patchClip(sel.id, { gainDb: v }, true)} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} />
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                {(['start', 'end'] as const).map((k) => (
                  <label key={k} className="space-y-1">
                    <span className="text-text-3">{k === 'start' ? 'Starts at' : 'Ends at'} (s, in the take)</span>
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      value={Number(sel[k].toFixed(2))}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        const max = takeOf(sel.takeId)?.duration_s ?? sel.end
                        if (k === 'start') patchClip(sel.id, { start: Math.min(Math.max(0, v), sel.end - MIN_CLIP_S) }, true)
                        else patchClip(sel.id, { end: Math.max(Math.min(max, v), sel.start + MIN_CLIP_S) }, true)
                      }}
                      className="h-7 w-full rounded-[6px] bg-fill-control px-2 font-[var(--font-mono)] tabular-nums outline-none"
                    />
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-text-3">Select a clip to adjust its gain and exact start and end.</p>
          )}
        </GlassPanel>
        <GlassPanel className="space-y-4 p-5">
          <h3 className="text-[13px] font-semibold">Whole edit</h3>
          <div className="grid grid-cols-2 gap-4">
            <Slider label="Fade in" value={mix.fadeInS} min={0} max={5} step={0.05} onChange={(v) => patchMix({ fadeInS: v })} format={(v) => `${v.toFixed(2)} s`} />
            <Slider label="Fade out" value={mix.fadeOutS} min={0} max={5} step={0.05} onChange={(v) => patchMix({ fadeOutS: v })} format={(v) => `${v.toFixed(2)} s`} />
            <Slider label="Gap between clips" value={mix.gapS} min={0} max={3} step={0.05} onChange={(v) => patchMix({ gapS: v })} format={(v) => (v ? `${v.toFixed(2)} s` : 'Crossfade')} />
            <Slider label="Crossfade" value={mix.crossfadeMs} min={0} max={200} step={5} disabled={mix.gapS > 0} onChange={(v) => patchMix({ crossfadeMs: v })} format={(v) => `${v.toFixed(0)} ms`} />
            <Slider label="Overall gain" value={mix.gainDb} min={-20} max={12} step={0.5} onChange={(v) => patchMix({ gainDb: v })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} />
            <label className="flex items-center justify-between gap-3 self-end pb-1 text-[12px]">
              <span>
                <span className="block font-medium">Normalize</span>
                <span className="text-[11px] text-text-3">Peak at −1 dB, applied on save</span>
              </span>
              <Switch label="Normalize" checked={mix.normalize} onChange={(v) => patchMix({ normalize: v }, false)} />
            </label>
          </div>
        </GlassPanel>
      </div>
      {clips.length > 0 && (
        <p className="flex items-center gap-1 px-1 text-[11px] text-text-3">
          Your originals are never changed — saving creates a new take in History. <ArrowRight size={10} />
        </p>
      )}
    </div>
  )
}
