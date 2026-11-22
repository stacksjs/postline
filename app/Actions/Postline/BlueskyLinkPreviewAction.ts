import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { safeFetch, UnsafeUrlError } from '../../Support/Http/safe-fetch'

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
      // The metadata a preview needs sits in <head>, so a quarter of a
      // megabyte is plenty and the rest of the page is never read.
      const fetched = await safeFetch(String(request.get('url') || '').trim(), {
        timeoutMs: 5000,
        maxBytes: 250_000,
        headers: {
          'accept': 'text/html,application/xhtml+xml',
          'user-agent': 'Postline/0.1 link-preview',
        },
      })

      if (fetched.status < 200 || fetched.status >= 300)
        throw new UnsafeUrlError(`That page answered with an error (${fetched.status}).`)

      const url = fetched.url
      const html = new TextDecoder().decode(fetched.bytes)
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
      // Only messages written for the person who pasted the link are passed
      // on; anything else is a network or parsing failure they cannot act on.
      return response.json({
        ok: false,
        error: error instanceof UnsafeUrlError ? error.message : 'That link could not be previewed.',
      }, { status: 422 })
    }
  },
})
