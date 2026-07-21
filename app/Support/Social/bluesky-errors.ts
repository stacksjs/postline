import { BlueskyApiError } from '../../Services/Social/Drivers/BlueskyDriver'

/**
 * Turn a raw publish/timeline failure into a short, actionable message.
 * ATProto errors arrive as `BlueskyApiError` (HTTP status + JSON body);
 * network failures arrive as generic fetch errors.
 */
export function describeBlueskyError(error: unknown): string {
  if (error instanceof BlueskyApiError) {
    if (error.status === 429)
      return 'Bluesky rate limit reached — wait a few minutes, then try again.'
    if (error.status === 401 || error.status === 403)
      return 'Bluesky session expired — reconnect your account on the Accounts page.'
    if (error.status === 413)
      return 'That image is too large for Bluesky (1MB max).'
    if (error.status >= 500)
      return 'Bluesky is having trouble right now — try again shortly.'
    // Prefer the ATProto body message when present (bad blob, invalid record…).
    try {
      const parsed = JSON.parse(error.body)
      if (parsed?.message)
        return `Bluesky rejected the post: ${parsed.message}`
      if (parsed?.error)
        return `Bluesky rejected the post: ${parsed.error}`
    }
    catch {}
    return error.message
  }

  const message = error instanceof Error ? error.message : String(error)
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|timed out|timeout/i.test(message))
    return 'Couldn\'t reach Bluesky — check your connection and try again.'
  return message
}
