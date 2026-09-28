import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, Send } from 'lucide-react'
import { Button } from '@/components/glass'
import { CodeBlock } from '@/components/code-block'
import { voxd, type OpenApiDoc, type OpenApiOperation, type OpenApiSchema } from '@/lib/voxd/client'
import { useConnection, useOpenApi } from '@/lib/voxd/queries'
import { cn } from '@/lib/cn'
import { KEY_PLACEHOLDER, useSessionKey } from './session-key'

const METHOD_TINT: Record<string, string> = {
  get: 'bg-[#0a84ff]/15 text-[#0a84ff]',
  post: 'bg-[#30d158]/15 text-[#30d158]',
  put: 'bg-[#ff9f0a]/15 text-[#ff9f0a]',
  patch: 'bg-[#bf5af2]/15 text-[#bf5af2]',
  delete: 'bg-[#ff453a]/15 text-[#ff453a]',
}

interface Endpoint {
  method: string
  path: string
  op: OpenApiOperation
  tag: string
}

// ---------------------------------------------------------------- schema helpers

function resolve(doc: OpenApiDoc, s: OpenApiSchema | undefined): OpenApiSchema | undefined {
  if (!s) return undefined
  if (s.$ref) return resolve(doc, doc.components?.schemas?.[s.$ref.split('/').pop()!])
  if (s.anyOf) {
    const real = s.anyOf.find((x) => x.type !== 'null')
    return real ? { ...resolve(doc, real), description: s.description ?? real.description, default: s.default ?? real.default } : s
  }
  return s
}

function typeName(doc: OpenApiDoc, s: OpenApiSchema | undefined): string {
  const r = resolve(doc, s)
  if (!r) return 'any'
  if (r.enum) return r.enum.map((v) => JSON.stringify(v)).join(' | ')
  if (r.type === 'array') return `${typeName(doc, r.items)}[]`
  if (r.title && r.properties) return r.title
  return (Array.isArray(r.type) ? r.type.join(' | ') : r.type) ?? 'object'
}

function example(doc: OpenApiDoc, s: OpenApiSchema | undefined, name = '', depth = 0): unknown {
  const r = resolve(doc, s)
  if (!r || depth > 3) return null
  if (r.default !== undefined) return r.default
  if (r.enum) return r.enum[0]
  switch (Array.isArray(r.type) ? r.type[0] : r.type) {
    case 'string':
      return name === 'text' || name === 'input' ? 'Hello from VoxStudio.' : name === 'voice' ? 'af_heart' : name === 'path' ? '/Users/me/Desktop/file.wav' : name === 'name' ? 'Example' : '…'
    case 'integer':
    case 'number':
      return r.minimum ?? 1
    case 'boolean':
      return false
    case 'array':
      return []
    default: {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r.properties ?? {})) {
        const rv = resolve(doc, v)
        if (r.required?.includes(k) || rv?.default !== undefined) out[k] = example(doc, v, k, depth + 1)
      }
      // The sample voice is a Kokoro voice; say so wherever the engine can be chosen.
      if (out.voice === 'af_heart' && r.properties && 'engine' in r.properties) out.engine = 'kokoro'
      return out
    }
  }
}

function bodyOf(doc: OpenApiDoc, op: OpenApiOperation): { kind: 'json' | 'form'; schema: OpenApiSchema } | null {
  const content = op.requestBody?.content
  if (!content) return null
  if (content['application/json']?.schema) return { kind: 'json', schema: resolve(doc, content['application/json'].schema)! }
  const form = content['multipart/form-data']?.schema ?? content['application/x-www-form-urlencoded']?.schema
  return form ? { kind: 'form', schema: resolve(doc, form)! } : null
}

// ---------------------------------------------------------------- snippets

function snippets(doc: OpenApiDoc, ep: Endpoint, base: string, key: string, bodyText: string, path: string) {
  const body = bodyOf(doc, ep.op)
  const url = `${base}${path}`
  const M = ep.method.toUpperCase()
  if (body?.kind === 'form') {
    const fields = Object.entries(body.schema.properties ?? {}).filter(([k]) => body.schema.required?.includes(k) || k === 'file')
    const isFile = (k: string) => typeName(doc, body.schema.properties?.[k]).includes('string') && (k === 'file' || k === 'audio')
    return [
      { label: 'curl', code: `curl -X ${M} "${url}" \\\n  -H "Authorization: Bearer ${key}"${fields.map(([k]) => ` \\\n  -F ${isFile(k) ? `${k}=@recording.wav` : `${k}=…`}`).join('')}` },
      { label: 'Python', code: `import requests\n\nres = requests.${ep.method}(\n    "${url}",\n    headers={"Authorization": "Bearer ${key}"},\n    files={${fields.filter(([k]) => isFile(k)).map(([k]) => `"${k}": open("recording.wav", "rb")`).join(', ')}},\n    data={${fields.filter(([k]) => !isFile(k)).map(([k]) => `"${k}": "…"`).join(', ')}},\n)\nprint(res.json())` },
      { label: 'JavaScript', code: `const form = new FormData()\n${fields.map(([k]) => (isFile(k) ? `form.append('${k}', fileInput.files[0])` : `form.append('${k}', '…')`)).join('\n')}\n\nconst res = await fetch('${url}', {\n  method: '${M}',\n  headers: { Authorization: 'Bearer ${key}' },\n  body: form,\n})\nconsole.log(await res.json())` },
    ]
  }
  const hasBody = body?.kind === 'json' && bodyText.trim()
  let compact = bodyText
  try {
    compact = JSON.stringify(JSON.parse(bodyText))
  } catch {
    /* keep what the user typed */
  }
  return [
    { label: 'curl', code: `curl${M === 'GET' ? '' : ` -X ${M}`} "${url}" \\\n  -H "Authorization: Bearer ${key}"${hasBody ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${compact.replace(/'/g, "'\\''")}'` : ''}` },
    { label: 'Python', code: `import requests\n\nres = requests.${ep.method}(\n    "${url}",\n    headers={"Authorization": "Bearer ${key}"},${hasBody ? `\n    json=${compact.replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')},` : ''}\n)\nprint(res.status_code, res.text[:500])` },
    { label: 'JavaScript', code: `const res = await fetch('${url}', {\n  method: '${M}',\n  headers: { Authorization: 'Bearer ${key}'${hasBody ? ", 'Content-Type': 'application/json'" : ''} },${hasBody ? `\n  body: JSON.stringify(${compact}),` : ''}\n})\nconsole.log(res.status, await res.text())` },
  ]
}

// ---------------------------------------------------------------- UI

function FieldTable({ doc, rows }: { doc: OpenApiDoc; rows: { name: string; where?: string; required?: boolean; schema?: OpenApiSchema; description?: string }[] }) {
  if (!rows.length) return null
  return (
    <table className="w-full text-left text-[12px]">
      <tbody className="divide-y-[0.5px] divide-[var(--hairline)]">
        {rows.map((r) => {
          const s = resolve(doc, r.schema)
          return (
            <tr key={`${r.where}${r.name}`} className="align-top">
              <td className="w-40 py-1.5 pr-3">
                <code className="font-[var(--font-mono)] text-[12px] font-semibold">{r.name}</code>
                {r.required && <span className="ml-1 text-[#ff453a]">*</span>}
                <div className="text-[10px] text-text-3">{r.where ? `${r.where} · ` : ''}{typeName(doc, r.schema)}</div>
              </td>
              <td className="py-1.5 text-text-2">
                {r.description ?? s?.description}
                {s?.default !== undefined && s.default !== null && <span className="ml-1 text-text-3">Default {JSON.stringify(s.default)}.</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function EndpointDetail({ doc, ep, base }: { doc: OpenApiDoc; ep: Endpoint; base: string }) {
  const key = useSessionKey((s) => s.key) ?? KEY_PLACEHOLDER
  const body = bodyOf(doc, ep.op)
  const initialBody = body?.kind === 'json' ? JSON.stringify(example(doc, body.schema), null, 2) : ''
  const [path, setPath] = useState(ep.path)
  const [bodyText, setBodyText] = useState(initialBody)
  const [sending, setSending] = useState(false)
  const [reply, setReply] = useState<{ status: number; text: string; ms: number } | null>(null)
  useEffect(() => {
    setPath(ep.path)
    setBodyText(initialBody)
    setReply(null)
  }, [ep.path, ep.method, initialBody])

  const send = async () => {
    setSending(true)
    try {
      setReply(await voxd.raw(ep.method.toUpperCase(), path, bodyText))
    } catch (e) {
      setReply({ status: 0, text: (e as Error).message, ms: 0 })
    } finally {
      setSending(false)
    }
  }

  const params = (ep.op.parameters ?? []).map((p) => ({ name: p.name, where: p.in, required: p.required, schema: p.schema, description: p.description }))
  const fields = body ? Object.entries(body.schema.properties ?? {}).map(([name, schema]) => ({ name, required: body.schema.required?.includes(name), schema })) : []
  const canTry = body?.kind !== 'form' && ep.path !== '/mcp' && !ep.path.startsWith('/v1/audio/speech')
  const destructive = ep.method === 'delete'

  return (
    <div className="min-w-0 space-y-5">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={cn('rounded-[5px] px-1.5 py-0.5 font-[var(--font-mono)] text-[11px] font-bold uppercase', METHOD_TINT[ep.method])}>{ep.method}</span>
          <code className="min-w-0 truncate font-[var(--font-mono)] text-[14px] font-semibold">{ep.path}</code>
        </div>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{ep.op.summary}</h3>
        {ep.op.description && <p className="text-[13px] leading-relaxed whitespace-pre-line text-text-2">{ep.op.description}</p>}
      </div>
      {params.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-[11px] font-semibold tracking-wide text-text-3">Parameters</h4>
          <FieldTable doc={doc} rows={params} />
        </section>
      )}
      {fields.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-[11px] font-semibold tracking-wide text-text-3">{body?.kind === 'form' ? 'Form fields (multipart)' : 'JSON body'}</h4>
          <FieldTable doc={doc} rows={fields} />
        </section>
      )}
      <section className="space-y-1.5">
        <h4 className="text-[11px] font-semibold tracking-wide text-text-3">Example</h4>
        <CodeBlock snippets={snippets(doc, ep, base, key, bodyText, path)} />
      </section>
      {canTry && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold tracking-wide text-text-3">Try it</h4>
          <div className="flex items-center gap-2">
            <span className={cn('shrink-0 rounded-[5px] px-1.5 py-0.5 font-[var(--font-mono)] text-[11px] font-bold uppercase', METHOD_TINT[ep.method])}>{ep.method}</span>
            <input value={path} onChange={(e) => setPath(e.target.value)} aria-label="Request path" spellCheck={false} className="h-8 min-w-0 flex-1 rounded-[8px] bg-fill-control px-2.5 font-[var(--font-mono)] text-[12px] outline-none" />
            <Button size="sm" variant={destructive ? 'secondary' : 'primary'} disabled={sending || /\{.+\}/.test(path)} onClick={() => void send()} className={cn(destructive && 'text-[#ff453a]')}>
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send
            </Button>
          </div>
          {/\{.+\}/.test(path) && <p className="text-[11px] text-text-3">Replace the {'{placeholders}'} in the path first.</p>}
          {body?.kind === 'json' && (
            <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={Math.min(12, bodyText.split('\n').length + 1)} aria-label="Request body" spellCheck={false} className="w-full resize-y rounded-[var(--radius-md)] bg-fill-control p-3 font-[var(--font-mono)] text-[12px] outline-none" />
          )}
          {reply && (
            <div className="overflow-hidden rounded-[var(--radius-md)] border-[0.5px] border-hairline animate-[pop-in_250ms_var(--ease-spring)_both]">
              <div className="flex items-center gap-2 border-b-[0.5px] border-hairline px-3 py-1.5 text-[11px]">
                <span className={cn('rounded-full px-2 py-px font-bold', reply.status >= 200 && reply.status < 300 ? 'bg-[#30d158]/15 text-[#30d158]' : 'bg-[#ff453a]/15 text-[#ff453a]')}>{reply.status || 'Error'}</span>
                <span className="text-text-3">{reply.ms} ms</span>
              </div>
              <pre className="max-h-72 overflow-auto p-3 font-[var(--font-mono)] text-[11.5px] leading-[1.55] select-text">{reply.text || '(empty)'}</pre>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export function ApiExplorer() {
  const doc = useOpenApi().data
  const base = useConnection().data?.url ?? 'http://127.0.0.1:4870'
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState('post /v1/speech')

  const endpoints = useMemo<Endpoint[]>(() => {
    if (!doc) return []
    return Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.entries(ops)
        .filter(([m]) => m in METHOD_TINT)
        .map(([method, op]) => ({ method, path, op, tag: op.tags?.[0] ?? 'Other' })),
    )
  }, [doc])
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hits = endpoints.filter((e) => !needle || `${e.method} ${e.path} ${e.op.summary ?? ''} ${e.tag}`.toLowerCase().includes(needle))
    const map = new Map<string, Endpoint[]>()
    for (const e of hits) map.set(e.tag, [...(map.get(e.tag) ?? []), e])
    return [...map.entries()]
  }, [endpoints, q])

  if (!doc) return <div className="h-96 animate-pulse rounded-[var(--radius-lg)] bg-fill-control" />
  const current = endpoints.find((e) => `${e.method} ${e.path}` === selected) ?? endpoints[0]

  return (
    <div className="grid min-h-[36rem] grid-cols-[15rem_1fr] gap-5">
      <nav aria-label="Endpoints" className="flex min-h-0 flex-col gap-2">
        <label className="flex h-8 items-center gap-2 rounded-[8px] bg-fill-control px-2.5">
          <Search size={13} className="text-text-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${endpoints.length} endpoints`} aria-label="Search endpoints" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-text-3" />
        </label>
        <div className="max-h-[40rem] min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {groups.map(([tag, list]) => (
            <div key={tag}>
              <div className="px-1.5 pb-1 text-[10px] font-semibold tracking-wide text-text-3 uppercase">{tag}</div>
              {list.map((e) => {
                const id = `${e.method} ${e.path}`
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelected(id)}
                    aria-current={id === `${current?.method} ${current?.path}`}
                    className={cn('flex w-full items-center gap-2 rounded-[7px] px-1.5 py-1 text-left', id === `${current?.method} ${current?.path}` ? 'bg-fill-active' : 'hover:bg-fill-hover')}
                  >
                    <span className={cn('w-11 shrink-0 rounded-[4px] py-px text-center font-[var(--font-mono)] text-[9px] font-bold uppercase', METHOD_TINT[e.method])}>{e.method}</span>
                    <span className="min-w-0 truncate text-[12px]" title={e.path}>
                      {e.op.summary ?? e.path}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </nav>
      {current && <EndpointDetail doc={doc} ep={current} base={base} />}
    </div>
  )
}
