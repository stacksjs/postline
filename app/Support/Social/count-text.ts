/**
 * Count a post the way each network counts it.
 *
 * Every limit used to be checked with `.length`, which counts UTF-16 units.
 * No network counts that way, so the composer and the server disagreed with
 * the network in both directions: a Bluesky post full of emoji was refused
 * here though Bluesky would take it, and an X post in Japanese passed here
 * and was refused by X.
 *
 * The composer and the server both import these rules.
 *
 * - Bluesky counts graphemes: one emoji, however it is built, is one.
 * - X counts a weighted length: most Latin text is one each, CJK and emoji
 *   are two, and a link is always 23 whatever its real length.
 * - Mastodon counts graphemes, a link as 23, and a mention without its
 *   server (`@name@example.social` counts as `@name`).
 * - Threads counts graphemes.
 * - LinkedIn, Instagram and the blog are counted in UTF-16 units. Their
 *   documentation gives a limit and no counting rule; UTF-16 is never smaller
 *   than the alternatives, so a post that passes here cannot be too long.
 */

const URL_LENGTH = 23

// A link as the networks find one: a scheme, or a bare domain with a common
// ending. Trailing punctuation belongs to the sentence, not the link, and a
// domain straight after an @ is the server of a mention, not a link.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|co|social|blog|ai|me|info|xyz|tv|fm|us|uk|de|fr|jp|ca|au|nl|ch|se|no|es|it)\b(?:\/[^\s<>]*)?/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/
const MASTODON_MENTIONS = /(?<![\w/])(@[\w.-]+)@[\w.-]+\.[a-z]{2,}/gi

let segmenter: Intl.Segmenter | undefined

/** The number of user-perceived characters. */
export function graphemes(text: string): number {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let count = 0
  // eslint-disable-next-line no-unused-vars
  for (const part of segmenter.segment(text)) count++
  return count
}

/** Split text into links and the text between them. */
function splitLinks(text: string): Array<{ link: boolean, value: string }> {
  const parts: Array<{ link: boolean, value: string }> = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const value = match[0].replace(TRAILING_PUNCTUATION, '')
    if (!value) continue
    const start = match.index
    if (start > last) parts.push({ link: false, value: text.slice(last, start) })
    parts.push({ link: true, value })
    last = start + value.length
  }
  if (last < text.length) parts.push({ link: false, value: text.slice(last) })
  return parts
}

/** X gives these ranges a weight of one; everything else counts double. */
function isLightForX(codePoint: number): boolean {
  return codePoint <= 0x10FF
    || (codePoint >= 0x2000 && codePoint <= 0x200D)
    || (codePoint >= 0x2010 && codePoint <= 0x201F)
    || (codePoint >= 0x2032 && codePoint <= 0x2037)
}

function weightedForX(text: string): number {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let total = 0
  for (const { segment } of segmenter.segment(text.normalize('NFC'))) {
    // An emoji is two however many code points build it.
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) {
      total += 2
      continue
    }
    for (const char of segment) total += isLightForX(char.codePointAt(0)!) ? 1 : 2
  }
  return total
}

function countForX(text: string): number {
  return splitLinks(text).reduce((sum, part) => sum + (part.link ? URL_LENGTH : weightedForX(part.value)), 0)
}

function countForMastodon(text: string): number {
  return splitLinks(text).reduce((sum, part) => {
    if (part.link) return sum + URL_LENGTH
    // The server part of a mention is not counted.
    return sum + graphemes(part.value.replace(MASTODON_MENTIONS, '$1'))
  }, 0)
}

/** The length `provider` would measure `text` at. */
export function countText(provider: string, text: string): number {
  const value = String(text ?? '')
  switch (provider) {
    case 'twitter':
      return countForX(value)
    case 'mastodon':
      return countForMastodon(value)
    case 'bluesky':
    case 'threads':
      return graphemes(value)
    default:
      return value.length
  }
}

/** Whether `text` is longer than `limit` on `provider`. A limit of 0 means none. */
export function exceedsLimit(provider: string, text: string, limit: number): boolean {
  return limit > 0 && countText(provider, text) > limit
}

/** A prefix that fits the limit, keeping emoji, links and remote mentions intact. */
export function textWithinLimit(provider: string, text: string, limit: number): string {
  if (!exceedsLimit(provider, text, limit)) return text
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const pieces = provider === 'mastodon' || provider === 'twitter' ? splitLinks(text) : [{ link: false, value: text }]
  let offset = 0
  let remaining = limit

  for (const piece of pieces) {
    const cost = piece.link ? URL_LENGTH : countText(provider, piece.value)
    if (cost <= remaining) {
      offset += piece.value.length
      remaining -= cost
      continue
    }
    if (piece.link) break

    const mentions = provider === 'mastodon'
      ? new Map([...piece.value.matchAll(MASTODON_MENTIONS)].map(match => [match.index, { value: match[0], cost: graphemes(match[1]!) }]))
      : new Map<number, { value: string, cost: number }>()
    let nextIndex = 0
    for (const { segment, index } of segmenter.segment(piece.value)) {
      if (index < nextIndex) continue
      const mention = mentions.get(index)
      const size = mention?.cost ?? countText(provider, segment)
      if (size > remaining) break
      nextIndex = index + (mention?.value.length ?? segment.length)
      remaining -= size
    }
    offset += nextIndex
    break
  }
  return text.slice(0, offset)
}
