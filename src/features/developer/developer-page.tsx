import { BookOpen, Copy, ExternalLink } from 'lucide-react'
import { Button, GlassPanel } from '@/components/glass'
import { copyText } from '@/components/code-block'
import { openExternal } from '@/lib/reveal'
import { useConnection } from '@/lib/voxd/queries'
import { ApiExplorer } from './api-explorer'
import { ApiKeys } from './api-keys'

const DOCS = 'https://vox-studio.devops-monk.com/docs/api/overview.html'

export function DeveloperPage() {
  const conn = useConnection().data
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Developer</h2>
          <p className="text-[14px] text-text-2">Everything in VoxStudio is available to your own scripts and apps through a local API.</p>
        </div>
        <Button size="sm" onClick={() => void openExternal(DOCS)}>
          <BookOpen size={12} /> API guide
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_1.25fr]">
        <GlassPanel className="space-y-3 p-5">
          <h3 className="text-[13px] font-semibold">Connection</h3>
          {[
            ['Base URL', conn?.url],
            ['OpenAI-compatible base', conn?.api_base],
            ['MCP endpoint', conn?.mcp_url],
          ].map(([label, value]) => (
            <div key={label} className="space-y-0.5">
              <div className="text-[11px] text-text-3">{label}</div>
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[12px]">{value ?? '…'}</code>
                <Button variant="ghost" size="icon" aria-label={`Copy ${label}`} disabled={!value} onClick={() => value && void copyText(value)}>
                  <Copy size={12} />
                </Button>
              </div>
            </div>
          ))}
          <Button size="sm" variant="ghost" disabled={!conn} onClick={() => conn && void openExternal(conn.docs_url)} className="-ml-2">
            Interactive reference in your browser <ExternalLink size={11} />
          </Button>
        </GlassPanel>
        <GlassPanel className="space-y-3 p-5">
          <div>
            <h3 className="text-[13px] font-semibold">API keys</h3>
            <p className="text-[12px] text-text-3">Send a key as <code className="font-[var(--font-mono)]">Authorization: Bearer …</code>.</p>
          </div>
          <ApiKeys compact />
        </GlassPanel>
      </div>

      <GlassPanel className="p-5">
        <ApiExplorer />
      </GlassPanel>
    </div>
  )
}
