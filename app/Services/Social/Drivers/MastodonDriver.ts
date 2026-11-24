/**
 * Mastodon publishing driver: the framework's, as it stands.
 *
 * Postline carried a subclass for the idempotency key, the instance's own
 * limits, up to four images with alt text, and visibility, content warnings
 * and language. All of it moved into `@stacksjs/socials`
 * (stacksjs/stacks@917822555c). What stays here is Postline's choice of key.
 */
export {
  MASTODON_DEFAULT_LIMITS,
  MastodonApiError,
  MastodonPublishingDriver,
  MastodonPublishingDriver as MastodonDriver,
  normalizeInstance,
} from '@stacksjs/socials'

export type { MastodonLimits, MastodonPublishOptions } from '@stacksjs/socials'

/**
 * The key for one post going to one account. It changes with the text, so a
 * post the owner edited after a failure is a new status and not answered
 * with the old one; it does not change between retries of the same text.
 */
export function mastodonIdempotencyKey(postId: number, identityId: number, text: string): string {
  return `postline-${postId}-${identityId}-${Bun.hash(text).toString(36)}`
}
