/**
 * Mastodon publishing driver.
 *
 * This used to be a full local implementation because `@stacksjs/socials`
 * shipped no Mastodon driver at all. It does now — including post deletion and
 * history enumeration — so this is a straight re-export.
 *
 * One shape change came with the move: the upstream driver takes the framework
 * `SocialIdentityCredentials` and reads the instance base URL from `did`,
 * rather than a bespoke `{ instance, accessToken }` pair. `MastodonService`
 * builds that shape.
 */
export {
  MastodonApiError,
  MastodonPublishingDriver,
  MastodonPublishingDriver as MastodonDriver,
  normalizeInstance,
} from '@stacksjs/socials'
