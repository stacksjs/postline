import { join } from 'node:path'
import { marketingPaths } from '../app/Support/Marketing/site'
import { url, urlTo } from '../config/domains'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')
const paths = marketingPaths(join(root, 'resources/views'))
const expected = [...paths, '/blog'].map(urlTo).sort()
const sitemap = await Bun.file(join(dist, 'sitemap.xml')).text()
const listed = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), match => match[1]).sort()
if (JSON.stringify(listed) !== JSON.stringify(expected))
  throw new Error(`Sitemap must list exactly the public pages on ${url}. Found ${listed.join(', ')}.`)

const robots = await Bun.file(join(dist, 'robots.txt')).text()
if (!robots.split(/\r?\n/).includes(`Sitemap: ${urlTo('/sitemap.xml')}`))
  throw new Error('robots.txt does not point to the canonical sitemap.')

for (const path of paths) {
  const html = await Bun.file(join(dist, path === '/' ? 'index.html' : `${path.slice(1)}.html`)).text()
  const attribute = (selector: string, name: string) => {
    const values: string[] = []
    new HTMLRewriter().on(selector, { element: (element) => { values.push(element.getAttribute(name) ?? '') } }).transform(html)
    if (values.length !== 1 || !values[0]) throw new Error(`${path} needs one ${name} on ${selector}.`)
    return values[0]
  }

  const canonical = attribute('link[rel=canonical]', 'href')
  const shareUrl = attribute('meta[property="og:url"]', 'content')
  const card = attribute('meta[property="og:image"]', 'content')
  const twitterCard = attribute('meta[name="twitter:image"]', 'content')
  if (canonical !== urlTo(path) || shareUrl !== canonical || !card.startsWith(`${url}/images/og/`) || twitterCard !== card)
    throw new Error(`${path} has inconsistent canonical or share URLs.`)

  if (path === '/') {
    for (const view of ['composer', 'queue']) {
      const photo = `picture img[src*="/product/${view}-light"]`
      const alternate = `picture source[srcset*="/product/${view}-dark"]`
      const alt = attribute(photo, 'alt')
      const light = attribute(photo, 'src')
      const dark = attribute(alternate, 'srcset')
      if (!alt.includes('Postline') || attribute(alternate, 'media') !== '(prefers-color-scheme: dark)')
        throw new Error(`The ${view} screenshot needs descriptive text and a dark version.`)
      for (const image of [light, dark]) {
        const file = Bun.file(join(dist, image))
        if (!image.startsWith('/images/product/') || !await file.exists() || file.size === 0)
          throw new Error(`Missing built product screenshot ${image}.`)
      }
    }
    const json = html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([^<]*)<\/script>/)?.[1]
    const graph: Record<string, unknown>[] = json ? JSON.parse(json)['@graph'] : []
    if (!Array.isArray(graph)) throw new Error('The home page is missing its structured data graph.')
    const application = graph.find(entry => entry['@type'] === 'SoftwareApplication')
    if (!application || application.url !== canonical
      || !graph.some(entry => entry['@type'] === 'FAQPage' && Array.isArray(entry.mainEntity) && entry.mainEntity.length))
      throw new Error('The home page is missing application or FAQ structured data.')
    if (application.operatingSystem !== 'macOS 13 or later' || application.processorRequirements !== 'Apple silicon (ARM64)')
      throw new Error('The software listing must describe the Apple silicon macOS desktop release.')
  }
  if (path === '/download') {
    if (!attribute('a[data-download-dmg]', 'href').endsWith('-macos-arm64.dmg')
      || !html.includes('Needs macOS 13 or later on Apple silicon') || !html.includes('Self-host and open in a browser'))
      throw new Error('The download page must identify the Mac build and describe browser access.')
  }
}
