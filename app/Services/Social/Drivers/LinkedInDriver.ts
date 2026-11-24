/**
 * LinkedIn publishing driver: the framework's, as it stands.
 *
 * Postline carried a subclass for the token exchange and refresh, image
 * upload, one image or a multi-image post with alt text, a current API
 * version and post text that keeps hashtags as hashtags. All of it moved into
 * `@stacksjs/socials` (stacksjs/stacks@917822555c).
 */
export {
  LINKEDIN_MAX_ALT_TEXT,
  LINKEDIN_MAX_IMAGES,
  LinkedInApiError,
  LinkedInPublishingDriver as LinkedInDriver,
} from '@stacksjs/socials'

export type { LinkedInRefreshInput, LinkedInTokenResponse as LinkedInRefreshedToken } from '@stacksjs/socials'
