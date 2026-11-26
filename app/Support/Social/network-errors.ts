/**
 * Say what went wrong on a network, and what to do about it.
 *
 * A failed publish used to store whatever the driver threw: a response body,
 * not an explanation. The failure is classified by `@stacksjs/socials`
 * (`classifySocialError`, which reads the status and the network's own
 * words); turning the kind into a sentence that says what to do is Postline's,
 * because it knows where its settings live.
 *
 * The kind also decides whether the account is treated as signed out. Only
 * `expired` does: a 403 is usually one refused post (a duplicate, a missing
 * permission), and treating it as signed out disconnected accounts that were
 * working.
 */
import type { SocialErrorKind } from '@stacksjs/socials'
import { classifySocialError, networkReason } from '@stacksjs/socials'

export { networkReason }

export type NetworkErrorKind = SocialErrorKind

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

/**
 * Explain a publish failure on `provider`.
 *
 * An error with no HTTP status that is not a network fault is one Postline
 * raised itself ("Connect X before publishing.", "Posts must be 280
 * characters or fewer."). It is already written for the owner and passes
 * through as it is.
 */
/** What Postline was doing when the network said no, so the message names it. */
export type NetworkAction = 'post' | 'delete' | 'read' | 'search' | 'metrics'

const DOING: Record<NetworkAction, { thing: string, verb: string }> = {
  post: { thing: 'take this post', verb: 'post' },
  delete: { thing: 'delete this post', verb: 'delete posts' },
  read: { thing: 'load your messages', verb: 'read messages' },
  search: { thing: 'run this search', verb: 'search' },
  metrics: { thing: 'load engagement metrics', verb: 'read engagement metrics' },
}

/**
 * A message thrown by Postline's own code reads well as it is; a network's
 * raw answer (a JSON or HTML body, a stack) does not, and is never shown (#134).
 */
function readable(message: string): boolean {
  return Boolean(message) && message.length <= 300 && !/[{}<>]|\n\s+at /.test(message)
}

export function explainNetworkError(provider: string, error: unknown, action: NetworkAction = 'post'): NetworkErrorExplanation {
  const name = NAMES[provider] || provider
  const doing = DOING[action]
  const { kind, status, reason } = classifySocialError(error)
  const own = String((error as { message?: unknown } | null)?.message ?? error ?? '')

  if (!status && kind === 'unknown')
    return { kind, message: readable(own) ? own : `${name} could not ${doing.thing}.` }

  const said = reason && readable(reason) ? ` ${name} said: ${reason}.` : ''
  switch (kind) {
    case 'expired':
      return { kind, message: `${name} no longer accepts this sign-in. Connect the account again under Settings, Channels.` }
    case 'permission':
      return { kind, message: `${name} did not allow this.${said} Check that the app or token has permission to ${doing.verb}, then try again.` }
    case 'rate-limited':
      return { kind, message: `${name} is limiting how often Postline can ${doing.verb} right now. It will try again later.` }
    case 'duplicate':
      return { kind, message: `${name} refused this as a duplicate of a post already there. Change the text, or leave it: the earlier post is up.` }
    case 'media':
      return { kind, message: `${name} would not take the image.${said} Try a smaller file or a different format.` }
    case 'content':
      return { kind, message: `${name} rejected the post.${said} Edit it and try again.` }
    case 'temporary':
      return { kind, message: status ? `${name} is having trouble right now (${status}). Postline will try again shortly.` : `Postline could not reach ${name}. It will try again shortly.` }
    default:
      return { kind, message: `${name} could not ${doing.thing}${status ? ` (${status})` : ''}.${said}` }
  }
}

export function describeNetworkError(provider: string, error: unknown, action: NetworkAction = 'post'): string {
  return explainNetworkError(provider, error, action).message
}
