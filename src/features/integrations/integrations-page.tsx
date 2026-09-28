import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Bot, Braces, Code2, MessageSquareCode, Monitor, SquareTerminal, Workflow, type LucideIcon } from 'lucide-react'
import { Button, GlassPanel } from '@/components/glass'
import { CodeBlock, type Snippet } from '@/components/code-block'
import { useConnection } from '@/lib/voxd/queries'
import type { Connection } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'
import { ApiKeys } from '@/features/developer/api-keys'
import { KEY_PLACEHOLDER, useSessionKey } from '@/features/developer/session-key'

interface Step {
  text: React.ReactNode
  code?: Snippet[]
}
interface Integration {
  id: string
  name: string
  kind: string
  icon: LucideIcon
  tint: string
  intro: string
  steps: (c: Connection, key: string) => Step[]
  after?: string
}

const mono = (s: string) => <code className="rounded-[4px] bg-fill-control px-1 py-px font-[var(--font-mono)] text-[12px]">{s}</code>

const INTEGRATIONS: Integration[] = [
  {
    id: 'openai',
    name: 'OpenAI SDKs',
    kind: 'Drop-in API',
    icon: Braces,
    tint: '#30d158',
    intro: 'Code written for OpenAI’s speech and transcription endpoints works with VoxStudio. Change the base URL and the key, and everything runs on this computer.',
    steps: (c, key) => [
      {
        text: <>Point the client at VoxStudio. Voices such as {mono('nova')} or {mono('onyx')} map to similar local voices. You can also pass any VoxStudio voice id, including your cloned {mono('cv_…')} voices.</>,
        code: [
          { label: 'Python', code: `from openai import OpenAI\n\nclient = OpenAI(base_url="${c.api_base}", api_key="${key}")\n\n# Text → speech\nwith client.audio.speech.with_streaming_response.create(\n    model="tts-1", voice="nova", input="Hello from VoxStudio!"\n) as res:\n    res.stream_to_file("hello.mp3")\n\n# Speech → text\ntext = client.audio.transcriptions.create(model="whisper-1", file=open("hello.mp3", "rb"))\nprint(text.text)` },
          { label: 'JavaScript', code: `import OpenAI from 'openai'\nimport fs from 'node:fs'\n\nconst client = new OpenAI({ baseURL: '${c.api_base}', apiKey: '${key}' })\n\nconst speech = await client.audio.speech.create({ model: 'tts-1', voice: 'nova', input: 'Hello from VoxStudio!' })\nfs.writeFileSync('hello.mp3', Buffer.from(await speech.arrayBuffer()))\n\nconst text = await client.audio.transcriptions.create({ model: 'whisper-1', file: fs.createReadStream('hello.mp3') })\nconsole.log(text.text)` },
          { label: 'curl', code: `curl ${c.api_base}/audio/speech \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "tts-1", "voice": "nova", "input": "Hello from VoxStudio!"}' \\\n  -o hello.mp3` },
        ],
      },
      { text: <>Formats: {mono('mp3')}, {mono('opus')}, {mono('aac')}, {mono('flac')}, {mono('wav')} and {mono('pcm')}. Transcripts come back as {mono('json')}, {mono('text')}, {mono('srt')}, {mono('vtt')} or {mono('verbose_json')}.</> },
    ],
    after: 'Every result is also saved in History or Transcribe, so you can replay, export or add it to a project.',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'MCP · HTTP',
    icon: SquareTerminal,
    tint: '#ff9f0a',
    intro: 'Let Claude Code speak, transcribe and clean up audio on this computer through the Model Context Protocol.',
    steps: (c, key) => [
      { text: 'Add VoxStudio as an MCP server:', code: [{ label: 'Terminal', code: `claude mcp add --transport http voxstudio ${c.mcp_url} \\\n  --header "Authorization: Bearer ${key}"` }] },
      { text: <>Then ask things like “read this changelog aloud with voice onyx” or “transcribe ~/Desktop/interview.m4a with timestamps”.</> },
    ],
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    kind: 'MCP · stdio',
    icon: MessageSquareCode,
    tint: '#bf5af2',
    intro: 'Claude Desktop starts local MCP servers as commands. VoxStudio includes a small bridge script for this. It needs nothing beyond Python 3.',
    steps: (c, key) => [
      { text: <>Open Claude Desktop → Settings → Developer → Edit Config, and add VoxStudio to {mono('mcpServers')}:</>, code: [{ label: 'claude_desktop_config.json', code: JSON.stringify({ mcpServers: { voxstudio: { command: 'python3', args: [c.bridge_path], env: { VOX_API_KEY: key } } } }, null, 2) }] },
      { text: 'Restart Claude Desktop. VoxStudio’s tools appear under the tools menu. Keep VoxStudio running while you use them.' },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor & VS Code',
    kind: 'MCP · HTTP',
    icon: Code2,
    tint: '#0a84ff',
    intro: 'Editors with MCP support can connect over HTTP. Use it to generate voice-over for demos, or transcribe recordings, without leaving your editor.',
    steps: (c, key) => [
      {
        text: <>Add this to {mono('~/.cursor/mcp.json')} for Cursor, or to {mono('.vscode/mcp.json')} for VS Code:</>,
        code: [
          { label: 'Cursor', code: JSON.stringify({ mcpServers: { voxstudio: { url: c.mcp_url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
          { label: 'VS Code', code: JSON.stringify({ servers: { voxstudio: { type: 'http', url: c.mcp_url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
        ],
      },
    ],
  },
  {
    id: 'agents',
    name: 'Your own agents',
    kind: 'MCP · any client',
    icon: Bot,
    tint: '#64d2ff',
    intro: 'Any MCP client can use VoxStudio. It supports Streamable HTTP with JSON responses, and stdio through the bridge.',
    steps: (c, key) => [
      {
        text: <>Tools: {mono('speak')}, {mono('list_voices')}, {mono('transcribe')}, {mono('clean_audio')}, {mono('convert_voice')} and {mono('add_pronunciation')}. Files are local paths. To save a result, pass {mono('save_to')} with a {mono('.mp3')}, {mono('.wav')}, {mono('.m4a')}, {mono('.opus')} or {mono('.flac')} path.</>,
        code: [
          { label: 'Python', code: `import requests\n\nMCP = "${c.mcp_url}"\nHEADERS = {"Authorization": "Bearer ${key}"}\n\ndef call(tool, **arguments):\n    msg = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": arguments}}\n    return requests.post(MCP, json=msg, headers=HEADERS).json()["result"]["content"][0]["text"]\n\nprint(call("speak", text="Build finished!", voice="nova", play=True))\nprint(call("transcribe", path="/Users/me/Desktop/memo.m4a"))` },
          { label: 'Raw JSON-RPC', code: `curl ${c.mcp_url} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call",\n       "params": {"name": "speak", "arguments": {"text": "Hello!", "play": true}}}'` },
        ],
      },
    ],
  },
  {
    id: 'n8n',
    name: 'n8n & automations',
    kind: 'HTTP',
    icon: Workflow,
    tint: '#ff375f',
    intro: 'Workflow tools can call VoxStudio with a plain HTTP request. For example, narrate new blog posts, or transcribe files as they arrive.',
    steps: (c, key) => [
      {
        text: <>Add an <b>HTTP Request</b> node with these settings. If n8n runs in Docker, replace {mono('127.0.0.1')} with {mono('host.docker.internal')}.</>,
        code: [{ label: 'HTTP Request node', code: `Method:        POST\nURL:           ${c.api_base}/audio/speech\nAuthentication: Generic → Header Auth\n  Name:        Authorization\n  Value:       Bearer ${key}\nBody (JSON):   {"model": "tts-1", "voice": "nova", "input": "{{ $json.text }}"}\nResponse:      File` }],
      },
      { text: <>Transcribe with {mono(`POST ${c.api_base}/audio/transcriptions`)}. Send the file as multipart field {mono('file')}.</> },
    ],
  },
  {
    id: 'shell',
    name: 'Terminal & Shortcuts',
    kind: 'HTTP',
    icon: Monitor,
    tint: '#8e8e93',
    intro: 'Quick one-liners for shell scripts, cron jobs and the macOS Shortcuts app.',
    steps: (c, key) => [
      {
        text: 'Speak a notification when a long command finishes:',
        code: [{ label: 'zsh', code: `say_vox() {\n  curl -s ${c.api_base}/audio/speech -H "Authorization: Bearer ${key}" \\\n    -H "Content-Type: application/json" \\\n    -d "{\\"voice\\": \\"nova\\", \\"input\\": \\"$1\\", \\"response_format\\": \\"wav\\"}" \\\n    -o /tmp/vox.wav && afplay /tmp/vox.wav\n}\n\nmake build && say_vox "Build finished"` }],
      },
      { text: <>In Shortcuts, use <b>Get Contents of URL</b>. Set the method to POST, add the Authorization header, set the request body to JSON with {mono('input')} and {mono('voice')}, then pass the result to <b>Play Sound</b>.</> },
    ],
  },
]

export function IntegrationsPage() {
  const conn = useConnection().data
  const key = useSessionKey((s) => s.key)
  const navigate = useNavigate()
  const [open, setOpen] = useState(INTEGRATIONS[0].id)
  const active = INTEGRATIONS.find((i) => i.id === open)!
  const Icon = active.icon

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Integrations</h2>
          <p className="text-[14px] text-text-2">Use VoxStudio’s voices from AI agents, editors, automations and your own code, all running locally.</p>
        </div>
        <Button size="sm" onClick={() => void navigate({ to: '/developer' })}>
          API explorer <ArrowRight size={11} />
        </Button>
      </header>

      <GlassPanel className="space-y-2 p-5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-[13px] font-semibold">1 · Get an API key</h3>
          {!key && <span className="text-[11px] text-text-3">Create one, and the snippets below will include it.</span>}
        </div>
        <ApiKeys compact />
      </GlassPanel>

      <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
        <nav aria-label="Integrations" className="space-y-1">
          <div className="px-1 pb-1 text-[13px] font-semibold">2 · Connect</div>
          {INTEGRATIONS.map((i) => {
            const I = i.icon
            return (
              <button
                key={i.id}
                type="button"
                aria-current={i.id === open}
                onClick={() => setOpen(i.id)}
                className={cn('flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors', i.id === open ? 'bg-fill-active' : 'hover:bg-fill-hover')}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-[8px] text-white" style={{ background: `linear-gradient(145deg, ${i.tint}, color-mix(in srgb, ${i.tint} 60%, black))` }}>
                  <I size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{i.name}</span>
                  <span className="block text-[10px] text-text-3">{i.kind}</span>
                </span>
              </button>
            )
          })}
        </nav>

        <GlassPanel key={active.id} className="min-w-0 space-y-4 p-6 animate-[pop-in_250ms_var(--ease-spring)_both]">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[11px] text-white" style={{ background: `linear-gradient(145deg, ${active.tint}, color-mix(in srgb, ${active.tint} 60%, black))` }}>
              <Icon size={19} />
            </span>
            <div>
              <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{active.name}</h3>
              <p className="text-[12px] text-text-3">{active.kind}</p>
            </div>
          </div>
          <p className="text-[13px] leading-relaxed text-text-2">{active.intro}</p>
          {conn ? (
            <ol className="space-y-4">
              {active.steps(conn, key ?? KEY_PLACEHOLDER).map((s, n) => (
                <li key={n} className="flex gap-3">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-fill-control text-[11px] font-semibold text-text-2">{n + 1}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="text-[13px] leading-relaxed">{s.text}</div>
                    {s.code && <CodeBlock snippets={s.code} />}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="h-40 animate-pulse rounded-[var(--radius-md)] bg-fill-control" />
          )}
          {active.after && <p className="text-[12px] text-text-3">{active.after}</p>}
        </GlassPanel>
      </div>
    </div>
  )
}
