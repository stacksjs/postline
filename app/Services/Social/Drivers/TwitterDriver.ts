/**
 * X/Twitter publishing driver: the framework's, as it stands.
 *
 * Postline carried a subclass here for up to four images, alt text, X's
 * weighted length count and a guarded image fetch. All of it moved into
 * `@stacksjs/socials` (stacksjs/stacks@917822555c), so this only gives the
 * driver the name the services import.
 */
export {
  TwitterApiError,
  TwitterPublishingDriver as TwitterDriver,
  X_MAX_ALT_TEXT,
  X_MAX_IMAGES,
} from '@stacksjs/socials'

export type {
  TwitterAuthUrlInput,
  TwitterDriverOptions,
  TwitterProfile,
  TwitterRefreshInput,
  TwitterToken,
  TwitterTokenExchangeInput,
} from '@stacksjs/socials'
