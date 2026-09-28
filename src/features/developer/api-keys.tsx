import { useState } from 'react'
import { KeyRound, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { copyText } from '@/components/code-block'
import { timeAgo } from '@/lib/time'
import { voxd } from '@/lib/voxd/client'
import { useApiKeys } from '@/lib/voxd/queries'
import { cn } from '@/lib/cn'
import { useSessionKey } from './session-key'

/** Create, list and revoke API keys. A new key is revealed once, in a highlighted box. */
export function ApiKeys({ compact = false }: { compact?: boolean }) {
  const keys = useApiKeys().data ?? []
  const { key: fresh, set: setFresh } = useSessionKey()
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)

  const create = async () => {
    const label = name.trim() || 'My key'
    try {
      const created = await voxd.createApiKey(label)
      setFresh(created.key)
      setName('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      {fresh && (
        <div className="space-y-2 rounded-[var(--radius-md)] border-[0.5px] border-[#30d158]/40 bg-[#30d158]/8 p-3 animate-[pop-in_300ms_var(--ease-spring)_both]">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[#30d158]">
            <KeyRound size={13} /> Your new key — copy it now, it won’t be shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[6px] bg-fill-control px-2 py-1.5 font-[var(--font-mono)] text-[12px] select-all">{fresh}</code>
            <Button size="sm" variant="primary" onClick={() => void copyText(fresh, 'Key copied')}>
              Copy
            </Button>
          </div>
          <p className="text-[11px] text-text-3">The setup snippets on this page already include it.</p>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        className="flex items-center gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What’s it for? e.g. n8n, Claude, my script"
          aria-label="Key name"
          maxLength={60}
          className="h-8 min-w-0 flex-1 rounded-[8px] bg-fill-control px-3 text-[13px] outline-none placeholder:text-text-3 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
        />
        <Button type="submit" size="sm" variant={fresh ? 'secondary' : 'primary'}>
          <Plus size={12} /> Create key
        </Button>
      </form>
      {keys.length > 0 && (
        <ul className={cn('divide-y-[0.5px] divide-[var(--hairline)] rounded-[var(--radius-md)] bg-fill-control', compact && 'max-h-40 overflow-y-auto')}>
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2">
              <KeyRound size={13} className="shrink-0 text-text-3" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{k.name}</div>
                <div className="truncate font-[var(--font-mono)] text-[11px] text-text-3">
                  {k.hint} · created {timeAgo(k.created_at)} · {k.last_used_at ? `used ${timeAgo(k.last_used_at)}` : 'never used'}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onBlur={() => setConfirm(null)}
                onClick={() => (confirm === k.id ? void voxd.revokeApiKey(k.id).then(() => toast('Key revoked')) : setConfirm(k.id))}
                className={cn(confirm === k.id && 'bg-[#ff453a]/12 text-[#ff453a]')}
              >
                <Trash2 size={12} /> {confirm === k.id ? 'Revoke' : ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <p className="flex items-start gap-2 text-[11px] text-text-3">
          <TriangleAlert size={12} className="mt-px shrink-0" />
          Keys can use every feature but can’t create other keys. VoxStudio only listens on this computer (127.0.0.1), so keys work for apps and scripts running here.
        </p>
      )}
    </div>
  )
}
