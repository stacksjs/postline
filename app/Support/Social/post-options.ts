/**
 * Choices about a post beyond its text: the language it is written in, and
 * Mastodon's visibility and content warning.
 *
 * The language goes to every network that records one (Bluesky, Mastodon),
 * where it decides who sees the post in language-filtered feeds and whether
 * it is offered for translation. Visibility and a content warning are
 * Mastodon's own and mean nothing elsewhere.
 */

export type MastodonVisibility = 'public' | 'unlisted' | 'private' | 'direct'

export interface PostOptions {
  /** A BCP 47 language tag such as `en` or `pt-BR`. */
  language?: string
  mastodon?: {
    visibility?: MastodonVisibility
    /** Text shown in place of the post until the reader opens it. */
    spoilerText?: string
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
  if ((visibility && visibility !== 'public') || spoilerText) {
    options.mastodon = {
      ...(visibility && visibility !== 'public' ? { visibility: visibility as MastodonVisibility } : {}),
      ...(spoilerText ? { spoilerText } : {}),
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
  const raw = value as { language?: unknown, mastodon?: { visibility?: unknown, spoilerText?: unknown }, firstComments?: Record<string, unknown> }
  const read = readPostOptions((key) => {
    if (key === 'language') return raw.language
    if (key === 'mastodon_visibility') return raw.mastodon?.visibility
    if (key === 'mastodon_spoiler') return raw.mastodon?.spoilerText
    if (key === 'linkedin_first_comment') return raw.firstComments?.linkedin
    if (key === 'instagram_first_comment') return raw.firstComments?.instagram
    return undefined
  })
  return read.ok ? read.options : undefined
}
