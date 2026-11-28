import { join } from 'node:path'
import { urlTo } from '../config/domains'

const root = join(import.meta.dir, '../dist/docs/.bunpress')
const base = new URL(urlTo('/docs/'))
const sitemap = await Bun.file(join(root, 'sitemap.xml')).text()
const pages = new Map<string, string>()
for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const href = match[1] ?? ''
  if (!href.startsWith(base.href)) throw new Error(`Unexpected docs sitemap URL: ${href}`)
  const path = href.slice(base.href.length).replace(/\/$/, '')
  pages.set(path, await Bun.file(join(root, path, 'index.html')).text())
}

const overview = pages.get('')
if (!overview) throw new Error('The docs sitemap is missing its overview.')

const pageIds = new Map<string, Set<string>>()
for (const [path, html] of pages) {
  const ids = new Set<string>()
  new HTMLRewriter().on('[id]', {
    element(element) {
      const id = element.getAttribute('id')
      if (id) ids.add(id)
    },
  }).transform(html)
  pageIds.set(path, ids)
}

const overviewLinks = new Set<string>()
for (const [path, html] of pages) {
  new HTMLRewriter().on('a[href]', {
    element(element) {
      const href = element.getAttribute('href')
      if (!href) return
      const target = new URL(href, new URL(path, base))
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) return
      const slug = target.pathname.slice(base.pathname.length).replace(/\/$/, '')
      if (!pages.has(slug)) throw new Error(`Broken docs link from /docs/${path} to ${href}.`)
      if (target.hash && !pageIds.get(slug)?.has(decodeURIComponent(target.hash.slice(1))))
        throw new Error(`Broken docs section link from /docs/${path} to ${href}.`)
      if (path === '') overviewLinks.add(slug)
    },
  }).transform(html)
}

for (const path of ['account-recovery', 'compose', 'planning', 'monitoring', 'workspace-data', 'security', 'troubleshooting', 'environment', 'recovery']) {
  if (!overviewLinks.has(path)) throw new Error(`The docs overview does not link to ${path}.`)
}

for (const path of ['es/networks', 'es/networks/bluesky', 'es/networks/mastodon', 'es/networks/linkedin', 'es/networks/instagram', 'es/networks/threads', 'es/networks/x']) {
  const html = pages.get(path)
  if (!html) throw new Error(`The docs sitemap is missing /docs/${path}.`)
  let hasSpanishHeading = false
  new HTMLRewriter().on('[lang="es"] h1', {
    element() { hasSpanishHeading = true },
  }).transform(html)
  if (!hasSpanishHeading) throw new Error(`The guide content in /docs/${path} must identify its language as Spanish.`)
}
