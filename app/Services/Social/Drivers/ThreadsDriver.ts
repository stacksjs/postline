/**
 * Threads publishing driver: the framework's, as it stands.
 *
 * Postline carried a subclass for replies, carousels, alt text, grapheme
 * counting and the long-lived token exchange. All of it moved into
 * `@stacksjs/socials` (stacksjs/stacks@917822555c).
 */
export {
  THREADS_MAX_IMAGES,
  ThreadsApiError,
  ThreadsPublishingDriver as ThreadsDriver,
} from '@stacksjs/socials'

export type { ThreadsLongLivedToken } from '@stacksjs/socials'
