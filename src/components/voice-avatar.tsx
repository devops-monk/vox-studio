import { cn } from '@/lib/cn'

/** A soft gradient disc with the voice's initial, colored deterministically from its id. */
export function VoiceAvatar({ id, name, size = 28, className }: { id: string; name: string; size?: number; className?: string }) {
  const hue = [...id].reduce((h, c) => (h * 33 + c.charCodeAt(0)) % 360, 11)
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-[0_0.5px_0_rgba(255,255,255,0.35)_inset]', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(140deg, hsl(${hue} 80% 64%), hsl(${(hue + 40) % 360} 70% 48%))`,
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  )
}
