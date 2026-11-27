export interface ComposerLinkPreview {
  source: string
  url: string
  domain: string
  title: string
  description: string
  image: string | null
}

export interface ComposerSegment {
  id: number
  text: string
  preview: ComposerLinkPreview | null
}

function httpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  }
  catch {
    return null
  }
}

export function firstComposerLink(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;]+$/, '')
  return httpUrl(match)?.href ?? null
}

export function composerLinkPreview(source: string, data?: Record<string, unknown>): ComposerLinkPreview | null {
  const url = httpUrl(data?.url) ?? httpUrl(source)
  if (!url) return null
  return {
    source,
    url: url.href,
    domain: url.hostname.replace(/^www\./, ''),
    title: typeof data?.title === 'string' && data.title.trim() ? data.title : url.href,
    description: typeof data?.description === 'string' ? data.description : '',
    image: httpUrl(data?.image)?.href ?? null,
  }
}
