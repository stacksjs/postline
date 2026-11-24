/**
 * Instagram publishing driver: the framework's, as it stands.
 *
 * Postline carried a subclass for carousels and the long-lived token
 * exchange. Both moved into `@stacksjs/socials` (stacksjs/stacks@917822555c).
 */
export {
  INSTAGRAM_MAX_IMAGES,
  InstagramApiError,
  InstagramPublishingDriver as InstagramDriver,
} from '@stacksjs/socials'

export type { InstagramLongLivedToken } from '@stacksjs/socials'
