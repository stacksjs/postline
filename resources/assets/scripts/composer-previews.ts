import { blogArticle } from '../../../app/Support/Social/blog-article'
import { requestJson } from '../../functions/postline-client'

export async function fetchBlogPreview(texts: string[], title: string | undefined, signal: AbortSignal): Promise<ReadonlyMap<string, string>> {
  const bodies = [...new Set(texts.map((text, index) => blogArticle(text.trim(), index === 0 ? title : undefined).body).filter(Boolean))]
  if (!bodies.length) return new Map()
  const { data } = await requestJson('/api/postline/blog/preview', {
    method: 'POST', body: JSON.stringify({ bodies }), signal,
  }) as { data: { html: string[] } }
  return new Map(bodies.map((body, index) => [body, data.html[index]!]))
}

/** A link's preview card, asked for once however often the composer redraws it. */
export async function fetchLinkPreview(url: string): Promise<Record<string, unknown>> {
  const endpoint = `/api/postline/bluesky/link-preview?url=${encodeURIComponent(url)}`
  const preview = window.stx.cachedQuery<Record<string, unknown> | null>(endpoint, {
    scope: false,
    staleTime: 30_000,
    load: async ({ signal }) => (await requestJson(endpoint, { signal }, 'Could not render link preview.')).data,
  })
  const data = await preview.load()
  if (!data) throw new Error(preview.error() || 'Could not render link preview.')
  return data
}
