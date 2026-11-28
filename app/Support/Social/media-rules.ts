/**
 * What each network accepts as an image, checked before anything is sent.
 *
 * The composer applied Bluesky's 1 MB cap to every network, and nothing else
 * was checked: a PNG queued for Instagram, which takes JPEG only, failed at
 * publish time with the network's own error. A post is now checked against
 * every network it is going to when it is saved, and the answer names the
 * network that objects and says why.
 *
 * Where Postline can convert an image to fit (`converts`), only what cannot
 * be converted is an objection: too many images, or a GIF too large to send.
 *
 * The sizes and formats are each network's published limits. `count` is how
 * many images Postline sends there, which is four everywhere: the most the
 * composer attaches, and within what each network allows.
 *
 * The composer and the server use these same checks.
 */

import { POST_IMAGE_FORMATS } from './media-limits'
import { composerMediaText } from './media-messages'

export { MAX_IMAGE_BYTES, MAX_POST_IMAGES, MAX_VIDEO_BYTES, POST_IMAGE_FORMATS } from './media-limits'

export interface MediaRule {
  /** Images per post that Postline sends to this network. */
  count: number
  /**
   * Whether Postline converts an image that is too large or the wrong kind
   * (see `image-fit.ts`) instead of refusing it. For the networks that fetch
   * images from an address, the converted copy is given a temporary one.
   */
  converts: boolean
  /** Largest file, in bytes. */
  maxBytes: number
  /** Accepted MIME types. */
  formats: readonly string[]
}

const MB = 1024 * 1024

export const MEDIA_RULES: Record<string, MediaRule> = {
  bluesky: { count: 4, converts: true, maxBytes: 1_000_000, formats: POST_IMAGE_FORMATS },
  twitter: { count: 4, converts: true, maxBytes: 5 * MB, formats: POST_IMAGE_FORMATS },
  mastodon: { count: 4, converts: true, maxBytes: 16 * MB, formats: POST_IMAGE_FORMATS },
  linkedin: { count: 4, converts: true, maxBytes: 8 * MB, formats: ['image/jpeg', 'image/png', 'image/gif'] },
  instagram: { count: 4, converts: true, maxBytes: 8 * MB, formats: ['image/jpeg'] },
  threads: { count: 4, converts: true, maxBytes: 8 * MB, formats: ['image/jpeg', 'image/png'] },
}

const NAMES: Record<string, string> = { bluesky: 'Bluesky', twitter: 'X', mastodon: 'Mastodon', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', blog: 'Blog' }
export function videoObjection(providers: readonly string[], locale = 'en'): string | undefined {
  const unsupported = [...new Set(providers)].filter(provider => provider !== 'bluesky' && provider !== 'mastodon')
  if (unsupported.length) {
    const text = composerMediaText(locale)
    return text('videoUnavailable', { networks: list(unsupported.map(provider => NAMES[provider] || provider), text('or')) })
  }
}

const FORMATS: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF' }

function megabytes(bytes: number, locale: string): string {
  const value = bytes / (bytes === 1_000_000 ? 1_000_000 : MB)
  const formatted = value.toLocaleString(locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  })
  return `${formatted} MB`
}

function list(values: readonly string[], conjunction: string): string {
  return values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} ${conjunction} ${values[values.length - 1]}`
}

export interface MediaItem {
  /** Size in bytes, when the file is in hand. An image given by address is not measured here. */
  bytes?: number
  mimeType?: string
}

/**
 * Every objection the given networks have to these images, one sentence
 * each, naming the network. Empty when all of them will take the post.
 * A network with no rule (the blog) accepts anything.
 */
export function mediaObjections(providers: readonly string[], media: readonly MediaItem[], locale = 'en'): string[] {
  if (media.length === 0) return []
  const objections: string[] = []
  const text = composerMediaText(locale)

  for (const provider of [...new Set(providers)]) {
    const rule = MEDIA_RULES[provider]
    if (!rule) continue
    const name = NAMES[provider] || provider

    if (media.length > rule.count) {
      const limit = rule.count === 1 ? text('oneImage') : text('severalImages', { limit: rule.count })
      objections.push(text('networkImageCount', { network: name, limit, count: media.length }))
    }

    media.slice(0, rule.count).forEach((item, index) => {
      // A still image that is too large or the wrong kind is converted for
      // this network at publish. A GIF is not: converting loses its animation.
      if (rule.converts && item.mimeType !== 'image/gif') return
      const image = media.length > 1 ? text('numberedImage', { number: index + 1 }) : text('thisImage')
      if (item.mimeType && !rule.formats.includes(item.mimeType)) {
        const formats = list(rule.formats.map(format => FORMATS[format] || format), text('or'))
        objections.push(text('networkImageFormat', { network: name, formats, image: image.toLowerCase(), actual: FORMATS[item.mimeType] || item.mimeType }))
      }
      if (item.bytes !== undefined && item.bytes > rule.maxBytes)
        objections.push(text('networkImageSize', { image, size: megabytes(item.bytes, locale), network: name, limit: megabytes(rule.maxBytes, locale) }))
    })
  }

  return objections
}

/** The largest file every one of these networks will take, for a first check before uploading. */
export function tightestImageBytes(providers: readonly string[]): number | null {
  const caps = providers.map(provider => MEDIA_RULES[provider]?.maxBytes).filter((cap): cap is number => typeof cap === 'number')
  return caps.length ? Math.min(...caps) : null
}
