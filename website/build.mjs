// Builds the static site into dist/: the landing page plus the documentation in ../docs.
//
// Docs Markdown extras (all plain Markdown otherwise):
//   ```bash title="curl"      consecutive titled code blocks become one tabbed code group
//   > [!NOTE] / [!TIP] / [!WARNING]   callout boxes
//   `POST /v1/speech`          inline HTTP method badges
//   first paragraph            shown as the page's lead
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import hljs from 'highlight.js'
import { Marked } from 'marked'
import { TABS, tabFor } from './docs-nav.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, 'dist')
const docsSrc = join(here, '..', 'docs')
const REPO = 'https://github.com/devops-monk/vox-studio'

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
cpSync(join(here, 'src'), dist, { recursive: true })
cpSync(join(here, 'public'), dist, { recursive: true })
cpSync(join(here, '..', 'public', 'favicon.svg'), join(dist, 'favicon.svg'))

// ---- icons (Lucide, ISC — read from the app's lucide-react package) ---------------
const iconCache = new Map()
function icon(name, size = 16) {
  if (!iconCache.has(name)) {
    const dir = join(here, '..', 'node_modules', 'lucide-react', 'dist', 'esm', 'icons')
    let src = readFileSync(join(dir, `${name}.mjs`), 'utf8')
    const alias = src.match(/export \{ default \} from '\.\/([\w-]+)\.mjs'/) // renamed icons re-export the new file
    if (alias) src = readFileSync(join(dir, `${alias[1]}.mjs`), 'utf8')
    const start = src.indexOf('const __iconData = ') + 'const __iconData = '.length
    const { node: nodes } = Function(`return ${src.slice(start, src.indexOf('\n};', start) + 2)}`)()
    iconCache.set(name, nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join(''))
  }
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconCache.get(name)}</svg>`
}
const GITHUB = '<svg class="i" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'

// ---- pages ------------------------------------------------------------------------
const pages = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name.endsWith('.md')) pages.push(relative(docsSrc, p).replace(/\\/g, '/'))
  }
}
walk(docsSrc)

const titleOf = (md) => (md.match(/^#\s+(.+)$/m)?.[1] ?? 'VoxStudio').replace(/`/g, '').trim()
const htmlPath = (rel) => (rel === 'README.md' ? 'index.html' : rel.replace(/\.md$/, '.html'))
const hrefOf = (rel) => '/docs/' + htmlPath(rel)
const md = Object.fromEntries(pages.map((rel) => [rel, readFileSync(join(docsSrc, rel), 'utf8')]))

// Complete the navigation with any unlisted page, then flatten it for prev/next.
const listed = new Set(TABS.flatMap((t) => t.groups.flatMap(([, items]) => items.map(([rel]) => rel))))
for (const rel of pages.filter((p) => !listed.has(p)).sort()) {
  const tab = TABS.find((t) => t.id === tabFor(rel))
  let more = tab.groups.find(([g]) => g === 'More')
  if (!more) tab.groups.push((more = ['More', []]))
  more[1].push([rel, 'file-text'])
}
const nav = TABS.flatMap((t) => t.groups.flatMap(([group, items]) => items.filter(([rel]) => md[rel]).map(([rel, ic, label]) => ({ rel, icon: ic, tab: t.id, group, label: label ?? titleOf(md[rel]) }))))
const navOf = Object.fromEntries(nav.map((n) => [n.rel, n]))

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const strip = (html) => html.replace(/<\/(p|li|h\d|td|th|div|pre)>|<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

// ---- Markdown → HTML --------------------------------------------------------------
const LANG_LABEL = { bash: 'Terminal', sh: 'Terminal', shell: 'Terminal', zsh: 'Terminal', python: 'Python', py: 'Python', js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', json: 'JSON', http: 'HTTP', yaml: 'YAML', xml: 'XML' }
const METHOD = /^(GET|POST|PUT|PATCH|DELETE|WS)\s+(\/\S*)$/

function parseInfo(info = '') {
  const lang = info.split(/\s+/)[0] || ''
  const title = info.match(/title="([^"]+)"/)?.[1]
  return { lang, title }
}

function highlight(code, lang) {
  const language = { sh: 'bash', zsh: 'bash', shell: 'bash', js: 'javascript', py: 'python', ts: 'typescript' }[lang] ?? lang
  if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value
  return escape(code)
}

const COPY = `<button class="copy" type="button" aria-label="Copy code">${icon('copy', 14)}</button>`

function codeBlock({ text, lang: info }) {
  const { lang, title } = parseInfo(info)
  const label = title ?? LANG_LABEL[lang] ?? (lang ? lang.toUpperCase() : 'Text')
  return `<div class="codeblock"><div class="codebar"><span class="codetitle">${escape(label)}</span>${COPY}</div><pre><code class="hljs">${highlight(text, lang)}</code></pre></div>\n`
}

function codeGroup(blocks) {
  const id = `g${Math.random().toString(36).slice(2, 8)}`
  const tabs = blocks.map((b, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${i}">${escape(parseInfo(b.lang).title)}</button>`).join('')
  const panes = blocks.map((b, i) => `<pre data-pane="${i}"${i ? ' hidden' : ''}><code class="hljs">${highlight(b.text, parseInfo(b.lang).lang)}</code></pre>`).join('')
  return `<div class="codeblock group" id="${id}"><div class="codebar"><div class="codetabs" role="tablist">${tabs}</div>${COPY}</div>${panes}</div>\n`
}

const CALLOUT = { NOTE: ['info', 'Note'], TIP: ['lightbulb', 'Tip'], WARNING: ['triangle-alert', 'Warning'], IMPORTANT: ['circle-alert', 'Important'] }

function renderPage(rel) {
  const fromDir = dirname(rel)
  const toc = []
  const ids = new Set()
  const slug = (text) => {
    let base = strip(text).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'section'
    let s = base
    for (let n = 2; ids.has(s); n++) s = `${base}-${n}`
    ids.add(s)
    return s
  }
  const marked = new Marked({
    walkTokens(token) {
      if (token.type !== 'link' || !token.href || /^[a-z]+:|^#|^\//i.test(token.href)) return
      const [file, hash] = token.href.split('#')
      if (file.endsWith('.md')) token.href = hrefOf(join(fromDir, file).replace(/\\/g, '/')) + (hash ? '#' + hash : '')
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        if (depth === 1) return `<h1>${html}</h1>\n`
        const id = slug(html)
        if (depth <= 3) toc.push({ depth, id, text: strip(html.replace(/<\/span><code>/g, ' <code>')).replace(/\s+/g, ' ').trim() })
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${html}</h${depth}>\n`
      },
      code(token) {
        return codeBlock(token)
      },
      codespan({ text }) {
        const raw = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        const m = raw.match(METHOD)
        if (m) return `<span class="endpoint"><span class="method m-${m[1].toLowerCase()}">${m[1]}</span><code>${escape(m[2])}</code></span>`
        return `<code>${text}</code>`
      },
      blockquote({ tokens, text }) {
        const m = text.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/)
        if (!m) return `<blockquote>${this.parser.parse(tokens)}</blockquote>\n`
        const [ic, label] = CALLOUT[m[1]]
        const inner = this.parser.parse(tokens).replace(/\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/, '')
        return `<div class="callout c-${m[1].toLowerCase()}"><div class="ctitle">${icon(ic, 15)} ${label}</div>${inner}</div>\n`
      },
      table(token) {
        const head = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`).join('')
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('')
        return `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`
      },
    },
  })

  // Merge runs of titled code blocks into tab groups.
  const tokens = marked.lexer(md[rel])
  const merged = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'code' && parseInfo(t.lang).title) {
      const run = [t]
      let j = i + 1
      while (j < tokens.length && (tokens[j].type === 'space' || (tokens[j].type === 'code' && parseInfo(tokens[j].lang).title))) {
        if (tokens[j].type === 'code') run.push(tokens[j])
        j++
      }
      if (run.length > 1) {
        merged.push({ type: 'html', block: true, raw: '', text: codeGroup(run), pre: false })
        i = j - 1
        continue
      }
    }
    merged.push(t)
  }
  merged.links = tokens.links
  let html = marked.parser(merged)
  html = html.replace(/(<\/h1>\s*)<p>/, '$1<p class="lead">') // the first paragraph is the page's lead
  return { html, toc }
}

// ---- layout -----------------------------------------------------------------------
function header(current) {
  const tabs = TABS.map((t) => `<a href="${hrefOf(t.home)}"${t.id === current.tab ? ' class="on" aria-current="true"' : ''}>${t.label}</a>`).join('')
  return `<header class="dh">
  <div class="dh-left">
    <button class="menu" type="button" aria-label="Open navigation">${icon('menu', 18)}</button>
    <a class="brand" href="/"><img src="/favicon.svg" alt="" width="26" height="26" /> VoxStudio <span class="chip">Docs</span></a>
  </div>
  <nav class="dtabs" aria-label="Documentation sections">${tabs}</nav>
  <div class="dh-right">
    <button class="search" type="button" aria-label="Search docs">${icon('search', 15)}<span>Search docs</span><kbd>⌘K</kbd></button>
    <a class="iconbtn" href="${REPO}" aria-label="VoxStudio on GitHub">${GITHUB}</a>
    <a class="dlbtn" href="/#download">${icon('download', 14)}<span>Download</span></a>
  </div>
</header>`
}

function sidebar(current) {
  const tab = TABS.find((t) => t.id === current.tab)
  const mobileTabs = `<div class="mtabs">${TABS.map((t) => `<a href="${hrefOf(t.home)}"${t.id === current.tab ? ' class="on"' : ''}>${t.label}</a>`).join('')}</div>`
  return mobileTabs + tab.groups
    .map(([group, items]) => {
      const links = items
        .filter(([rel]) => md[rel])
        .map(([rel]) => {
          const n = navOf[rel]
          const on = rel === current.rel
          return `<a href="${hrefOf(rel)}"${on ? ' class="on" aria-current="page"' : ''}>${icon(n.icon)}<span>${escape(n.label)}</span></a>`
        })
        .join('')
      return `<div class="sgroup"><h5>${escape(group)}</h5>${links}</div>`
    })
    .join('')
}

function tocHtml(toc) {
  if (toc.length < 2) return ''
  return `<div class="toc"><h5>${icon('list-checks', 14)} On this page</h5>${toc.map((h) => `<a href="#${h.id}" class="d${h.depth}">${escape(h.text)}</a>`).join('')}</div>`
}

function pager(current) {
  const i = nav.findIndex((n) => n.rel === current.rel)
  const prev = nav[i - 1]
  const next = nav[i + 1]
  const link = (n, dir) =>
    n ? `<a class="${dir}" href="${hrefOf(n.rel)}"><span class="lbl">${dir === 'prev' ? icon('arrow-left', 13) + ' Previous' : 'Next ' + icon('arrow-right', 13)}</span><span class="ttl">${escape(n.label)}</span></a>` : '<span></span>'
  return `<nav class="pager" aria-label="Pages">${link(prev, 'prev')}${link(next, 'next')}</nav>`
}

const searchIndex = []
for (const rel of pages) {
  const current = navOf[rel] ?? { rel, tab: tabFor(rel), label: titleOf(md[rel]), group: '' }
  const { html, toc } = renderPage(rel)
  const title = titleOf(md[rel])
  searchIndex.push({
    t: title,
    h: hrefOf(rel),
    s: `${TABS.find((t) => t.id === current.tab).label}${current.group ? ' › ' + current.group : ''}`,
    k: toc.map((x) => [x.text, x.id]),
    x: strip(html).replace(/\s+/g, ' ').slice(0, 3000),
  })
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escape(title)} · VoxStudio Docs</title>
  <meta name="description" content="${escape(strip(html.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? `VoxStudio documentation: ${title}`)).slice(0, 180)}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/docs.css" />
</head>
<body class="docs-page">
  <div class="ambient" aria-hidden="true"></div>
  ${header(current)}
  <div class="dshell">
    <aside class="dside" aria-label="Documentation">${sidebar(current)}</aside>
    <main class="dmain">
      <article class="prose">${html}</article>
      ${pager(current)}
      <footer class="dfoot"><a href="${REPO}/edit/main/docs/${rel}">${icon('pencil', 13)} Edit this page on GitHub</a><span>© 2026 VoxStudio · Apache-2.0</span></footer>
    </main>
    <aside class="dtoc" aria-label="On this page">${tocHtml(toc)}</aside>
  </div>
  <div class="sdialog" hidden role="dialog" aria-label="Search the docs">
    <div class="sbox">
      <label class="sfield">${icon('search', 16)}<input type="search" placeholder="Search guides and API…" aria-label="Search" autocomplete="off" spellcheck="false" /><kbd>esc</kbd></label>
      <div class="sresults" role="listbox"></div>
    </div>
  </div>
  <script src="/docs.js" defer></script>
</body>
</html>`
  const out = join(dist, 'docs', htmlPath(rel))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, page)
}
writeFileSync(join(dist, 'docs', 'search.json'), JSON.stringify(searchIndex))

writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://vox-studio.devops-monk.com/sitemap.xml\n')
const urls = ['/', ...pages.map(hrefOf)]
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>https://vox-studio.devops-monk.com${u}</loc></url>`).join('')}</urlset>\n`,
)
console.log(`built: landing + ${pages.length} docs pages → dist/`)
