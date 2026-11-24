/**
 * Bluesky publishing driver: the framework's, as it stands.
 *
 * Postline carried a subclass for grapheme counting, link-card pictures,
 * post languages and telling a session error from a rejected post. All of it
 * moved into `@stacksjs/socials` (stacksjs/stacks@917822555c). One driver
 * talks to one server; `BlueskyService` keeps one per account server.
 */
import type { PublishPostInput } from '@stacksjs/socials'

export {
  BLUESKY_MAX_BLOB_BYTES,
  BlueskyApiError,
  BlueskyPublishingDriver as BlueskyDriver,
  isBlueskySessionError,
  parseAtUri,
} from '@stacksjs/socials'

/** What a Bluesky publish takes, link-card picture included. */
export type BlueskyPublishInput = PublishPostInput
