// Docs page behaviour: copy buttons, code tabs, "On this page" scroll-spy, ⌘K search, mobile menu.
;(() => {
  const $ = (s, el = document) => el.querySelector(s)
  const $$ = (s, el = document) => [...el.querySelectorAll(s)]

  // Copy buttons (copy the visible pane of a code group).
  for (const btn of $$('.codeblock .copy')) {
    btn.addEventListener('click', async () => {
      const block = btn.closest('.codeblock')
      const pre = $$('pre', block).find((p) => !p.hidden)
      try {
        await navigator.clipboard.writeText(pre.innerText.replace(/\n$/, ''))
        btn.classList.add('done')
        setTimeout(() => btn.classList.remove('done'), 1400)
      } catch {}
    })
  }

  // Code tabs; the chosen language is remembered across pages.
  const pick = (label) => {
    for (const group of $$('.codeblock.group')) {
      const tabs = $$('[role=tab]', group)
      const i = tabs.findIndex((t) => t.textContent === label)
      if (i < 0) continue
      tabs.forEach((t, k) => t.setAttribute('aria-selected', String(k === i)))
      $$('pre', group).forEach((p, k) => (p.hidden = k !== i))
    }
  }
  for (const tab of $$('.codetabs [role=tab]')) {
    tab.addEventListener('click', () => {
      pick(tab.textContent)
      try { localStorage.setItem('vox-docs-lang', tab.textContent) } catch {}
    })
  }
  try {
    const saved = localStorage.getItem('vox-docs-lang')
    if (saved) pick(saved)
  } catch {}

  // "On this page" scroll-spy.
  const tocLinks = $$('.toc a')
  if (tocLinks.length) {
    const targets = tocLinks.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean)
    const update = () => {
      let current = targets[0]
      for (const t of targets) if (t.getBoundingClientRect().top < 120) current = t
      tocLinks.forEach((a) => a.classList.toggle('on', a.hash.slice(1) === current?.id))
    }
    addEventListener('scroll', update, { passive: true })
    update()
  }

  // Mobile navigation drawer.
  $('.dh .menu')?.addEventListener('click', () => document.body.classList.toggle('nav-open'))
  $('.dside')?.addEventListener('click', (e) => e.target.closest('a') && document.body.classList.remove('nav-open'))

  // ⌘K search over /docs/search.json.
  const dialog = $('.sdialog')
  const input = $('.sfield input')
  const results = $('.sresults')
  let index = null
  let active = 0
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const mark = (text, words) => words.reduce((out, w) => out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>'), esc(text))

  const search = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const hits = []
    for (const page of index) {
      const title = page.t.toLowerCase()
      const body = page.x.toLowerCase()
      if (!words.every((w) => title.includes(w) || body.includes(w) || page.k.some(([h]) => h.toLowerCase().includes(w)))) continue
      let score = words.reduce((s, w) => s + (title.includes(w) ? 10 : 0) + (title.startsWith(w) ? 5 : 0), 0)
      const heading = page.k.find(([h]) => words.every((w) => h.toLowerCase().includes(w)))
      if (heading) score += 6
      const at = body.indexOf(words[0])
      const snippet = at < 0 ? page.x.slice(0, 140) : (at > 40 ? '…' : '') + page.x.slice(Math.max(0, at - 40), at + 140)
      hits.push({ page, heading, snippet, score })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 12).map((h) => ({ ...h, words }))
  }
  const render = () => {
    const hits = search(input.value)
    active = 0
    results.innerHTML = hits.length
      ? hits
          .map(
            (h, i) =>
              `<a href="${h.page.h}${h.heading ? '#' + h.heading[1] : ''}" class="${i === 0 ? 'on' : ''}" role="option"><div class="ss">${esc(h.page.s)}</div><div class="st">${mark(h.page.t, h.words)}${h.heading ? ` <span style="color:var(--text-3);font-weight:500">› ${mark(h.heading[0], h.words)}</span>` : ''}</div><div class="sx">${mark(h.snippet, h.words)}</div></a>`,
          )
          .join('')
      : `<div class="empty">${input.value.trim() ? 'No results. Try other words.' : 'Search guides, API endpoints and settings'}</div>`
  }
  const open = async () => {
    dialog.hidden = false
    input.value = ''
    input.focus()
    render()
    if (!index) {
      index = await (await fetch('/docs/search.json')).json()
      render()
    }
  }
  const close = () => (dialog.hidden = true)
  $('.dh .search')?.addEventListener('click', open)
  dialog?.addEventListener('mousedown', (e) => e.target === dialog && close())
  input?.addEventListener('input', () => index && render())
  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      dialog.hidden ? open() : close()
    } else if (e.key === '/' && dialog.hidden && !/input|textarea/i.test(document.activeElement?.tagName)) {
      e.preventDefault()
      open()
    } else if (!dialog.hidden) {
      const links = $$('a', results)
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % Math.max(1, links.length)
        links.forEach((a, i) => a.classList.toggle('on', i === active))
        links[active]?.scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'Enter' && links[active]) location.href = links[active].href
    }
  })
})()
