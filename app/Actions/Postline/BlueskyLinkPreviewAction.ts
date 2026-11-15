import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'

const META_RE = /<meta\s+[^>]*(?:property|name)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>|<meta\s+[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']([^"']+)["'][^>]*>/gi
const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePreviewUrl(value: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https links can be previewed.')
  }

  return url
}

function absolutize(value: string | undefined, base: URL): string | undefined {
  if (!value) return undefined

  try {
    return new URL(value, base).toString()
  }
  catch {
    return undefined
  }
}

export default new Action({
  name: 'Postline Bluesky Link Preview',
  description: 'Fetch Open Graph metadata for a link preview.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const url = normalizePreviewUrl(String(request.get('url') || '').trim())
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const previewResponse = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Postline/0.1 link-preview',
        },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!previewResponse.ok) {
        throw new Error(`Could not fetch link preview (${previewResponse.status}).`)
      }

      const html = (await previewResponse.text()).slice(0, 250000)
      const meta = new Map<string, string>()
      for (const match of html.matchAll(META_RE)) {
        const key = String(match[1] || match[4] || '').toLowerCase()
        const content = decodeHtml(String(match[2] || match[3] || ''))
        if (key && content && !meta.has(key)) meta.set(key, content)
      }

      const title = meta.get('og:title')
        || meta.get('twitter:title')
        || decodeHtml(html.match(TITLE_RE)?.[1] || '')
        || url.hostname
      const description = meta.get('og:description') || meta.get('description') || meta.get('twitter:description') || ''
      const image = absolutize(meta.get('og:image') || meta.get('twitter:image'), url)

      return response.json({
        ok: true,
        data: {
          url: url.toString(),
          domain: url.hostname.replace(/^www\./, ''),
          title,
          description,
          image,
        },
      })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
  },
})
