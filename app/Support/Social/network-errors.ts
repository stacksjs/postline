/**
 * Say what went wrong on a network, and what to do about it.
 *
 * A failed publish used to store whatever the driver threw: `Twitter API
 * failed (403): {"detail":"You are not allowed to create a Tweet with
 * duplicate content.","type":"about:blank",...}`. That is a response body,
 * not an explanation. Here every failure is put in one of a few kinds, each
 * with a sentence about what happened and one about what to do.
 *
 * The kind also decides whether the account is treated as signed out. Only
 * `expired` does: most drivers called every 403 an expired token, so X
 * refusing a duplicate post, or a token without one permission, disconnected
 * an account that was working.
 *
 * No imports: an error is read by its `status` and `body`, which every driver
 * error carries, so nothing here depends on a driver.
 */

export type NetworkErrorKind
  = | 'expired'
    | 'permission'
    | 'rate-limited'
    | 'duplicate'
    | 'content'
    | 'media'
    | 'temporary'
    | 'unknown'

export interface NetworkErrorExplanation {
  kind: NetworkErrorKind
  /** What happened and what to do, ready to show. */
  message: string
}

const NAMES: Record<string, string> = {
  bluesky: 'Bluesky',
  twitter: 'X',
  mastodon: 'Mastodon',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  threads: 'Threads',
  blog: 'The blog',
}

/** The short sentence a network gives as its reason, when it gives one. */
export function networkReason(body: unknown): string {
  let parsed: any
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : body
  }
  catch {
    return ''
  }
  if (!parsed || typeof parsed !== 'object') return ''

  const first = Array.isArray(parsed.errors) ? parsed.errors[0] : undefined
  const candidates = [
    parsed.detail,
    parsed.error?.error_user_msg,
    parsed.error?.message,
    parsed.message,
    parsed.error_description,
    first?.detail,
    first?.message,
    typeof parsed.error === 'string' ? parsed.error : undefined,
  ]
  for (const candidate of candidates) {
    const text = typeof candidate === 'string' ? candidate.replace(/\s+/g, ' ').trim() : ''
    // A sentence, not a code or a dump: short, with a space, no braces.
    if (text && text.length <= 200 && text.includes(' ') && !/[{}<>]/.test(text)) return text.replace(/[.!]+$/, '')
  }
  return ''
}

function kindOf(status: number, text: string): NetworkErrorKind {
  const has = (pattern: RegExp): boolean => pattern.test(text)

  if (status === 429 || has(/rate.?limit|too many requests|usage cap|throttl/i)) return 'rate-limited'
  if (has(/duplicate|already (?:posted|published|exists)|DUPLICATE_POST/i)) return 'duplicate'
  if (status === 401 || has(/invalid.?token|expired.?token|token (?:has )?(?:expired|been revoked)|session has (?:expired|been invalidated)|OAuthException.*(?:expired|invalid)|REVOKED_ACCESS_TOKEN/i)) return 'expired'
  if (status === 413 || has(/media|image|video|attachment|aspect ratio|file size|unsupported (?:format|type)|blob/i)) return 'media'
  if (status === 403 || has(/permission|scope|not (?:allowed|authorized|permitted)|forbidden|ACCESS_DENIED|insufficient/i)) return 'permission'
  if (status === 408 || status >= 500) return 'temporary'
  if (status === 400 || status === 404 || status === 409 || status === 422) return 'content'
  if (has(/fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|timed? ?out|socket|aborted/i)) return 'temporary'
  return 'unknown'
}

/**
 * Explain a publish failure on `provider`.
 *
 * An error with no HTTP status that is not a network fault is one Postline
 * raised itself ("Connect X before publishing.", "Posts must be 280
 * characters or fewer."). It is already written for the owner and passes
 * through as it is.
 */
export function explainNetworkError(provider: string, error: unknown): NetworkErrorExplanation {
  const name = NAMES[provider] || provider
  const source = (error ?? {}) as { status?: unknown, body?: unknown, message?: unknown }
  const status = Number(source.status) || 0
  const own = String(source.message ?? error ?? '')
  const reason = networkReason(source.body)
  const kind = kindOf(status, `${reason} ${typeof source.body === 'string' ? source.body.slice(0, 2000) : ''} ${status ? '' : own}`)

  if (!status && kind === 'unknown')
    return { kind, message: own || `${name} could not take this post.` }

  const said = reason ? ` ${name} said: ${reason}.` : ''
  switch (kind) {
    case 'expired':
      return { kind, message: `${name} no longer accepts this sign-in. Connect the account again under Settings, Channels.` }
    case 'permission':
      return { kind, message: `${name} did not allow this.${said} Check that the app or token has permission to post, then try again.` }
    case 'rate-limited':
      return { kind, message: `${name} is limiting how often you can post right now. Postline will try again later.` }
    case 'duplicate':
      return { kind, message: `${name} refused this as a duplicate of a post already there. Change the text, or leave it: the earlier post is up.` }
    case 'media':
      return { kind, message: `${name} would not take the image.${said} Try a smaller file or a different format.` }
    case 'content':
      return { kind, message: `${name} rejected the post.${said} Edit it and try again.` }
    case 'temporary':
      return { kind, message: status ? `${name} is having trouble right now (${status}). Postline will try again shortly.` : `Postline could not reach ${name}. It will try again shortly.` }
    default:
      return { kind, message: `${name} could not take this post${status ? ` (${status})` : ''}.${said}` }
  }
}

export function describeNetworkError(provider: string, error: unknown): string {
  return explainNetworkError(provider, error).message
}
