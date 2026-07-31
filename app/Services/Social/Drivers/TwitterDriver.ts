/**
 * X/Twitter publishing driver.
 *
 * This used to be a full local implementation because `@stacksjs/socials`
 * shipped only a *sign-in* provider for Twitter — no `publish`. It now ships a
 * publishing driver with PKCE auth, media upload, thread chaining, post
 * deletion, and history enumeration, so this is a straight re-export.
 */
export {
  TwitterApiError,
  TwitterPublishingDriver as TwitterDriver,
} from '@stacksjs/socials'

export type {
  TwitterAuthUrlInput,
  TwitterDriverOptions,
  TwitterProfile,
  TwitterRefreshInput,
  TwitterToken,
  TwitterTokenExchangeInput,
} from '@stacksjs/socials'
