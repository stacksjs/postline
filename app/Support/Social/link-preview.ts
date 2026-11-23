/**
 * Read a page's title, description and image for a link card.
 *
 * The page is fetched through the guarded fetch: the address comes from a
 * person, and must not be able to reach this machine's own network.
 */
import { safeFetch, UnsafeUrlError } from '../Http/safe-fetch'

const META_RE = /<meta\s+[^>]*(?:property|name)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>|<meta\s+[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']([^"']+)["'][^>]*>/gi
const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i

export interface LinkPreview {
  url: string
  domain: string
  title: string
  description: string
  image?: string
}

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

/** Pull the card fields out of a page's HTML. */
export function parseLinkPreview(html: string, url: URL): LinkPreview {
  const meta = new Map<string, string>()
  for (const match of html.matchAll(META_RE)) {
    const key = String(match[1] || match[4] || '').toLowerCase()
    const content = decodeHtml(String(match[2] || match[3] || ''))
    if (key && content && !meta.has(key)) meta.set(key, content)
  }

  return {
    url: url.toString(),
    domain: url.hostname.replace(/^www\./, ''),
    title: meta.get('og:title') || meta.get('twitter:title') || decodeHtml(html.match(TITLE_RE)?.[1] || '') || url.hostname,
    description: meta.get('og:description') || meta.get('description') || meta.get('twitter:description') || '',
    image: absolutize(meta.get('og:image') || meta.get('twitter:image'), url),
  }
}

/** Fetch a page and read its card. Throws `UnsafeUrlError` with a message for the person who pasted the link. */
export async function fetchLinkPreview(address: string): Promise<LinkPreview> {
  // The metadata a preview needs sits in <head>, so a quarter of a megabyte
  // is plenty and the rest of the page is never read.
  const fetched = await safeFetch(address.trim(), {
    timeoutMs: 5000,
    maxBytes: 250_000,
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': 'Postline/0.1 link-preview',
    },
  })

  if (fetched.status < 200 || fetched.status >= 300)
    throw new UnsafeUrlError(`That page answered with an error (${fetched.status}).`)

  return parseLinkPreview(new TextDecoder().decode(fetched.bytes), fetched.url)
}
