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
      if (path === '') overviewLinks.add(slug)
    },
  }).transform(html)
}

for (const path of ['compose', 'planning', 'monitoring', 'workspace-data', 'security', 'troubleshooting', 'environment', 'recovery']) {
  if (!overviewLinks.has(path)) throw new Error(`The docs overview does not link to ${path}.`)
}
