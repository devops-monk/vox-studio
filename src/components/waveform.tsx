import { useEffect, useRef, useState } from 'react'
import { loadPeaks } from '@/lib/audio/waveform-cache'
import { playbackPosition, usePlayer } from '@/lib/audio/player'
import { cn } from '@/lib/cn'

interface Props {
  id: string
  url: string
  duration: number
  className?: string
}

/** Bar waveform that fills with the accent as the shared player plays this item. Click to seek. */
export function Waveform({ id, url, duration, className }: Props) {
  const [bars, setBars] = useState<number[] | null>(null)
  const [progress, setProgress] = useState(0)
  const { current, play, seek } = usePlayer()
  const active = current === id
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    loadPeaks(id, url).then((p) => alive && setBars(p), () => alive && setBars([]))
    return () => {
      alive = false
    }
  }, [id, url])

  useEffect(() => {
    if (!active) return setProgress(0)
    let raf = 0
    const tick = () => {
      const { time, duration: d } = playbackPosition()
      setProgress(d ? time / d : 0)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  const onClick = async (e: React.MouseEvent) => {
    const rect = box.current!.getBoundingClientRect()
    const at = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (!active) await play(id, url)
    seek(at * duration)
  }

  return (
    <div
      ref={box}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(progress * duration)}
      tabIndex={-1}
      onClick={(e) => void onClick(e)}
      className={cn('flex h-9 cursor-pointer items-center gap-[2px]', className)}
    >
      {(bars ?? Array.from({ length: 96 }, () => 0.15)).map((h, i, all) => {
        const played = i / all.length < progress
        return (
          <span
            key={i}
            className={cn('flex-1 rounded-full transition-colors duration-150', played ? 'bg-[var(--accent)]' : 'bg-[var(--hairline-strong)]', !bars && 'animate-pulse')}
            style={{ height: `${Math.max(8, h * 100)}%` }}
          />
        )
      })}
    </div>
  )
}
