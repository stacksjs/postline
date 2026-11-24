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
 * No imports, so the composer can run the same check before uploading.
 */

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
const COMMON = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export const MEDIA_RULES: Record<string, MediaRule> = {
  bluesky: { count: 4, converts: true, maxBytes: 1_000_000, formats: COMMON },
  twitter: { count: 4, converts: true, maxBytes: 5 * MB, formats: COMMON },
  mastodon: { count: 4, converts: true, maxBytes: 16 * MB, formats: COMMON },
  linkedin: { count: 4, converts: true, maxBytes: 8 * MB, formats: ['image/jpeg', 'image/png', 'image/gif'] },
  instagram: { count: 4, converts: true, maxBytes: 8 * MB, formats: ['image/jpeg'] },
  threads: { count: 4, converts: true, maxBytes: 8 * MB, formats: ['image/jpeg', 'image/png'] },
}

const NAMES: Record<string, string> = { bluesky: 'Bluesky', twitter: 'X', mastodon: 'Mastodon', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads' }
const FORMATS: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF' }

function megabytes(bytes: number): string {
  const value = bytes / (bytes === 1_000_000 ? 1_000_000 : MB)
  return `${Number.isInteger(value) ? value : value.toFixed(1)} MB`
}

function list(values: readonly string[]): string {
  return values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`
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
export function mediaObjections(providers: readonly string[], media: readonly MediaItem[]): string[] {
  if (media.length === 0) return []
  const objections: string[] = []

  for (const provider of [...new Set(providers)]) {
    const rule = MEDIA_RULES[provider]
    if (!rule) continue
    const name = NAMES[provider] || provider

    if (media.length > rule.count)
      objections.push(`${name} takes ${rule.count === 1 ? 'one image' : `up to ${rule.count} images`} per post; this post has ${media.length}.`)

    media.slice(0, rule.count).forEach((item, index) => {
      // A still image that is too large or the wrong kind is converted for
      // this network at publish. A GIF is not: converting loses its animation.
      if (rule.converts && item.mimeType !== 'image/gif') return
      const which = media.length > 1 ? `Image ${index + 1}` : 'This image'
      if (item.mimeType && !rule.formats.includes(item.mimeType))
        objections.push(`${name} takes ${list(rule.formats.map(format => FORMATS[format] || format))} only; ${which.toLowerCase()} is a ${FORMATS[item.mimeType] || item.mimeType}.`)
      if (item.bytes !== undefined && item.bytes > rule.maxBytes)
        objections.push(`${which} is ${megabytes(item.bytes)}; ${name} takes up to ${megabytes(rule.maxBytes)}.`)
    })
  }

  return objections
}

/** The largest file every one of these networks will take, for a first check before uploading. */
export function tightestImageBytes(providers: readonly string[]): number | null {
  const caps = providers.map(provider => MEDIA_RULES[provider]?.maxBytes).filter((cap): cap is number => typeof cap === 'number')
  return caps.length ? Math.min(...caps) : null
}
