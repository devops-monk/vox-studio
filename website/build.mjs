// Builds the static site into dist/: the landing page plus HTML versions of ../docs.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, 'dist')
const docsSrc = join(here, '..', 'docs')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
cpSync(join(here, 'src'), dist, { recursive: true })
cpSync(join(here, 'public'), dist, { recursive: true })
cpSync(join(here, '..', 'public', 'favicon.svg'), join(dist, 'favicon.svg'))

// ---- docs -----------------------------------------------------------------------
const pages = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name.endsWith('.md')) pages.push(relative(docsSrc, p))
  }
}
walk(docsSrc)

const titleOf = (md) => (md.match(/^#\s+(.+)$/m)?.[1] ?? 'VoxStudio').trim()
const htmlPath = (rel) => (rel === 'README.md' ? 'index.html' : rel.replace(/\.md$/, '.html'))
const meta = pages.map((rel) => ({ rel, href: '/docs/' + htmlPath(rel), title: titleOf(readFileSync(join(docsSrc, rel), 'utf8')) }))

const GROUPS = [
  ['Start', (m) => m.rel === 'README.md'],
  ['Guides', (m) => m.rel.startsWith('guides/')],
  ['Developers', (m) => m.rel.startsWith('api/') && !m.rel.startsWith('api/reference/')],
  ['API reference', (m) => m.rel.startsWith('api/reference/')],
]
const ORDER = ['first-voice', 'studio', 'clone', 'design', 'voices', 'dub', 'stories-audiobooks', 'transcribe', 'dictation', 'history', 'activity', 'models', 'overview', 'quickstart', 'authentication', 'errors']
const rank = (m) => {
  const i = ORDER.indexOf(m.rel.split('/').pop().replace('.md', ''))
  return i < 0 ? 100 : i
}

const sidebar = (current) =>
  GROUPS.map(([label, test]) => {
    const items = meta.filter(test).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
    if (!items.length) return ''
    const links = items
      .map((m) => `<a href="${m.href}"${m.rel === current ? ' class="on" aria-current="page"' : ''}>${m.rel === 'README.md' ? 'Overview' : m.title}</a>`)
      .join('')
    return `<h5>${label}</h5>${links}`
  }).join('')

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

for (const m of meta) {
  const md = readFileSync(join(docsSrc, m.rel), 'utf8')
  const fromDir = dirname(m.rel)
  // Rewrite relative .md links to the generated .html pages.
  const body = new Marked({
    walkTokens(token) {
      if (token.type !== 'link' || !token.href || /^[a-z]+:|^#|^\//i.test(token.href)) return
      const [file, hash] = token.href.split('#')
      if (file.endsWith('.md')) token.href = '/docs/' + htmlPath(join(fromDir, file).replace(/\\/g, '/')) + (hash ? '#' + hash : '')
    },
  }).parse(md)
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escape(m.title)} · VoxStudio Docs</title>
  <meta name="description" content="VoxStudio documentation: ${escape(m.title)}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="ambient" aria-hidden="true"></div>
  <nav class="top glass" aria-label="Main">
    <a class="brand" href="/"><img src="/favicon.svg" alt="" /> VoxStudio</a>
    <div class="links"><a href="/#features" class="optional">Features</a><a href="/docs/">Docs</a><a href="/docs/api/overview.html">API</a></div>
  </nav>
  <div class="docs wrap">
    <aside class="glass" aria-label="Documentation">${sidebar(m.rel)}</aside>
    <article class="glass">${body}</article>
  </div>
</body>
</html>`
  const out = join(dist, 'docs', htmlPath(m.rel))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, page)
}

writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://vox-studio.devops-monk.com/sitemap.xml\n')
const urls = ['/', ...meta.map((m) => m.href)]
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>https://vox-studio.devops-monk.com${u}</loc></url>`).join('')}</urlset>\n`,
)
console.log(`built: landing + ${meta.length} docs pages → dist/`)
