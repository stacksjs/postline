/**
 * Choices about a post beyond its text: the language it is written in, and
 * network-specific visibility, warnings, polls, quotes and content labels.
 *
 * The language goes to every network that records one (Bluesky, Mastodon),
 * where it decides who sees the post in language-filtered feeds and whether
 * it is offered for translation. Visibility and a content warning are
 * Mastodon's own and mean nothing elsewhere.
 */

import { UserFacingError } from '../Http/user-error'

export type MastodonVisibility = 'public' | 'unlisted' | 'private' | 'direct'

export interface PostPoll {
  options: string[]
  expiresIn: number
  multiple?: boolean
  hideTotals?: boolean
}

export interface PostOptions {
  /** A BCP 47 language tag such as `en` or `pt-BR`. */
  language?: string
  mastodon?: {
    visibility?: MastodonVisibility
    /** Text shown in place of the post until the reader opens it. */
    spoilerText?: string
    poll?: PostPoll
    quote?: string
  }
  bluesky?: {
    quote?: string
    selfLabels?: string[]
  }
  firstComments?: Partial<Record<FirstCommentProvider, string>>
}

export const FIRST_COMMENT_PROVIDERS = ['linkedin', 'instagram'] as const
export type FirstCommentProvider = typeof FIRST_COMMENT_PROVIDERS[number]
export const MAX_FIRST_COMMENT_LENGTH = 1250

/** Queue this write in the same update that records the published parent. */
export function pendingFirstComment(options: PostOptions | undefined, provider: FirstCommentProvider) {
  const body = options?.firstComments?.[provider]
  return body ? { first_comment_body: body, first_comment_status: 'pending' } : {}
}

const VISIBILITIES: readonly MastodonVisibility[] = ['public', 'unlisted', 'private', 'direct']
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/
export const MAX_SPOILER_LENGTH = 500
export const POST_OPTION_FIELDS = ['language', 'mastodon_visibility', 'mastodon_spoiler', 'mastodon_poll', 'mastodon_quote', 'bluesky_quote', 'bluesky_labels', 'linkedin_first_comment', 'instagram_first_comment'] as const

function jsonField(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? undefined
  if (!raw.trim()) return undefined
  try {
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}

function pollFrom(value: unknown): PostPoll | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { options, expiresIn, multiple, hideTotals } = value as Partial<PostPoll>
  if (!Array.isArray(options) || options.length < 2 || options.length > 50
    || options.some(option => typeof option !== 'string' || !option.trim() || option.length > 1000)
    || typeof expiresIn !== 'number' || !Number.isSafeInteger(expiresIn) || expiresIn <= 0
    || (multiple !== undefined && typeof multiple !== 'boolean')
    || (hideTotals !== undefined && typeof hideTotals !== 'boolean')) return undefined
  const choices = options.map(option => option.trim())
  if (new Set(choices).size !== choices.length) return undefined
  return { options: choices, expiresIn, ...(multiple && { multiple }), ...(hideTotals && { hideTotals }) }
}

function quoteLink(value: string, bluesky: boolean): string | undefined {
  if (value.length > 2048) return undefined
  // AT URIs accept a DID as their authority, which is not a web URL host.
  if (bluesky && /^at:\/\/(?:did:[a-z]+:[a-z0-9._:%-]+|[a-z0-9.-]+)\/app\.bsky\.feed\.post\/[a-z0-9._:~-]{1,512}$/i.test(value))
    return value
  const url = URL.parse(value)
  if (!url || url.username || url.password) return undefined
  if (url.protocol !== 'https:') return undefined
  if (bluesky && (url.origin !== 'https://bsky.app' || !/^\/profile\/[^/]+\/post\/[a-z0-9._:~-]+\/?$/i.test(url.pathname)))
    return undefined
  url.hash = ''
  return url.href
}

export type PostOptionsResult = { ok: true, options: PostOptions | undefined } | { ok: false, error: string }

/**
 * Read the options a request sends. A field left out is left out: an absent
 * `language` is "not set", not an error. Returns undefined when nothing is set,
 * so a post without options stores nothing.
 */
export function readPostOptions(get: (key: string) => unknown): PostOptionsResult {
  const text = (key: string): string => String(get(key) ?? '').trim()
  const options: PostOptions = {}

  const language = text('language')
  if (language) {
    if (!LANGUAGE.test(language)) return { ok: false, error: `"${language}" is not a language code Postline knows, such as en or pt-BR.` }
    options.language = language
  }

  const visibility = text('mastodon_visibility')
  const spoilerText = text('mastodon_spoiler')
  if (visibility && !VISIBILITIES.includes(visibility as MastodonVisibility))
    return { ok: false, error: 'Mastodon visibility must be public, unlisted, followers only or mentioned people only.' }
  if (spoilerText.length > MAX_SPOILER_LENGTH)
    return { ok: false, error: `A content warning can be up to ${MAX_SPOILER_LENGTH} characters.` }
  const mastodonAddress = text('mastodon_quote')
  const mastodonQuote = mastodonAddress ? quoteLink(mastodonAddress, false) : undefined
  if (mastodonAddress && !mastodonQuote) return { ok: false, error: 'Enter an HTTPS link to a Mastodon post.' }
  const rawPoll = jsonField(get('mastodon_poll'))
  const poll = pollFrom(rawPoll)
  if (rawPoll !== undefined && !poll)
    return { ok: false, error: 'A Mastodon poll needs at least two distinct choices and a duration.' }
  if (poll && mastodonQuote)
    return { ok: false, error: 'Choose a poll or a quoted post on Mastodon.' }

  if ((visibility && visibility !== 'public') || spoilerText || poll || mastodonQuote) {
    options.mastodon = {
      ...(visibility && visibility !== 'public' ? { visibility: visibility as MastodonVisibility } : {}),
      ...(spoilerText ? { spoilerText } : {}),
      ...(poll && { poll }),
      ...(mastodonQuote && { quote: mastodonQuote }),
    }
  }

  const blueskyAddress = text('bluesky_quote')
  const blueskyQuote = blueskyAddress ? quoteLink(blueskyAddress, true) : undefined
  if (blueskyAddress && !blueskyQuote) return { ok: false, error: 'Enter a Bluesky post link or AT URI to quote.' }
  const labels = jsonField(get('bluesky_labels'))
  if (labels !== undefined && (!Array.isArray(labels) || labels.length > 10
    || labels.some(label => typeof label !== 'string' || label.length > 128 || !/^!?[a-z]+(?:-[a-z]+)*$/.test(label)))) {
    return { ok: false, error: 'Choose up to ten valid Bluesky content labels.' }
  }
  if (blueskyQuote || labels?.length) {
    options.bluesky = {
      ...(blueskyQuote && { quote: blueskyQuote }),
      ...(labels?.length && { selfLabels: [...new Set(labels as string[])] }),
    }
  }

  for (const provider of FIRST_COMMENT_PROVIDERS) {
    const raw = get(`${provider}_first_comment`)
    if (raw == null || raw === '') continue
    if (typeof raw !== 'string' || raw.trim().length > MAX_FIRST_COMMENT_LENGTH)
      return { ok: false, error: `A first comment can be up to ${MAX_FIRST_COMMENT_LENGTH.toLocaleString('en-US')} characters.` }
    if (raw.trim()) (options.firstComments ??= {})[provider] = raw.trim()
  }

  return { ok: true, options: Object.keys(options).length ? options : undefined }
}

/** Options as stored: re-checked on read, since stored content is free-form JSON. */
export function sanitizePostOptions(value: unknown): PostOptions | undefined {
  if (!value || typeof value !== 'object') return undefined
  const read = readStoredPostOptions(value)
  return read.ok ? read.options : undefined
}

function readStoredPostOptions(value: unknown): PostOptionsResult {
  const raw = value as PostOptions | undefined
  if ([raw, raw?.mastodon, raw?.bluesky, raw?.firstComments].some(option =>
    option != null && (typeof option !== 'object' || Array.isArray(option)),
  )) return { ok: false, error: 'Open this post in Composer to review its options.' }

  const fields: Record<typeof POST_OPTION_FIELDS[number], unknown> = {
    language: raw?.language,
    mastodon_visibility: raw?.mastodon?.visibility,
    mastodon_spoiler: raw?.mastodon?.spoilerText,
    mastodon_poll: raw?.mastodon?.poll,
    mastodon_quote: raw?.mastodon?.quote,
    bluesky_quote: raw?.bluesky?.quote,
    bluesky_labels: raw?.bluesky?.selfLabels,
    linkedin_first_comment: raw?.firstComments?.linkedin,
    instagram_first_comment: raw?.firstComments?.instagram,
  }
  return readPostOptions(key => fields[key as keyof typeof fields])
}

/** Publishing must refuse to send a post whose stored options are invalid. */
export class InvalidStoredPostOptionsError extends UserFacingError {
  constructor(reason: string) {
    super(`The saved post options could not be read. ${reason}`)
  }
}

export function requireStoredPostOptions(value: unknown): PostOptions | undefined {
  const parsed = readStoredPostOptions(value)
  if (!parsed.ok) throw new InvalidStoredPostOptionsError(parsed.error)
  return parsed.options
}
