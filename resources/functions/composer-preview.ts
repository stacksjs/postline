import type { ComposerTarget } from './composer-targets'
import type { ComposerSegment } from './composer-thread'
import { blogArticle } from '../../app/Support/Social/blog-article'
import { countText, textWithinLimit } from '../../app/Support/Social/count-text'
import { providerIcon, providerLabel } from './networks'
import { formatHandle } from './social-client'

export interface ComposerPreviewImage {
  id: string
  alt: string
  src: string
}

export function composerPreviewCards(input: {
  networks: readonly ComposerTarget[]
  segments: readonly ComposerSegment[]
  variants: Readonly<Record<string, string>>
  images: readonly ComposerPreviewImage[]
  title: string
  spoiler: string
  blogHtml: ReadonlyMap<string, string>
}) {
  return input.networks.map((target) => {
    const { provider, characterLimit: limit } = target
    const chained = ['bluesky', 'mastodon', 'threads', 'twitter'].includes(provider)
    const blog = provider === 'blog'
    return {
      provider,
      name: providerLabel(provider),
      icon: providerIcon(provider),
      handle: blog ? '' : formatHandle(provider, target.handle),
      chained,
      posts: input.segments.map((segment, index) => {
        const text = (input.variants[provider] || segment.text).trim()
        const count = countText(provider, text)
        const overflow = limit > 0 ? Math.max(0, count - limit) : 0
        const shown = overflow > 0 ? textWithinLimit(provider, text, limit) : text
        const title = index === 0 ? input.title : undefined
        const article = blog && (text || title) ? blogArticle(text, title) : null
        const images = index === 0 ? input.images : []
        const card = index === 0 && images.length === 0 && (provider === 'bluesky' || provider === 'linkedin')
          ? segment.preview
          : null
        return {
          id: segment.id,
          count: limit > 0 ? `${count} / ${limit}` : String(count),
          progress: limit > 0 ? Math.min(100, 5 * Math.ceil(20 * count / limit)) : 0,
          overflow,
          text: article?.body || shown,
          title: article?.title || '',
          html: article ? input.blogHtml.get(article.body) || '' : '',
          spoiler: provider === 'mastodon' ? input.spoiler.trim() : '',
          card,
          images,
        }
      }),
    }
  })
}

export function previewImageUrl(value: string): string {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : ''
  }
  catch {
    return ''
  }
}
