/**
 * Postline's social types.
 *
 * Eight of these used to be hand-copied from `@stacksjs/socials`, byte for
 * byte, and were drifting silently - `PublishPostInput` had already forked. The
 * framework is where the crossposting contract lives (it ships drivers for
 * Bluesky, Mastodon, X, Threads, LinkedIn, Instagram and Facebook), so the
 * shared ones are re-exported from there rather than restated.
 *
 * Re-exported through this module rather than imported directly by the twenty
 * consumers, so `import { ... } from '../../Support/Social/types'` keeps
 * working and the app keeps one place to see its own social surface.
 *
 * What stays local, and why, is below. The rule: if it is identical to core,
 * it is a re-export; if it genuinely differs, it is declared here with the
 * reason.
 */

import type { SocialPublishingProvider } from '@stacksjs/socials'

export type {
  /** One page of an account's own posts, for a purge. */
  AuthoredPost,
  AuthoredPostPage,
  BlueskySession,
  BlueskySessionCredentials,
  RemotePostRef,
  SocialIdentityCredentials,
  TimelineQuery,
  TimelineResult,
} from '@stacksjs/socials'

/**
 * One timeline post.
 *
 * Core names this `TimelineItem` as of stacksjs/stacks#2207, but Postline
 * installs `@stacksjs/socials` from the registry, so it cannot re-export the
 * name until a release carries it. Derived from `TimelineResult` in the
 * meantime, which is the same type by construction - swap this for a
 * re-export once the version lands.
 */
export type TimelineItem = import('@stacksjs/socials').TimelineResult['items'][number]

/**
 * Core's publishing providers plus `blog`.
 *
 * Postline crossposts to its own blog alongside the social networks, which is
 * not something the framework knows about - so the union extends rather than
 * replaces. Written as a union with the core type so a provider added upstream
 * arrives here for free.
 */
export type SocialProvider = SocialPublishingProvider | 'blog'

/**
 * Kept local: core's `PublishPostInput` carries `langs` and `reply` for thread
 * chaining, and Postline's carries `media` instead. Neither is a superset, so
 * this is a real fork rather than a copy - reconciling it means deciding
 * upstream whether media belongs in the core input.
 */
export interface PublishPostInput {
  text: string
  scheduledAt?: string
  external?: {
    uri: string
    title: string
    description?: string
  }
  media?: Array<{
    url: string
    altText?: string
  }>
}

/**
 * Kept local: structurally core's `PublishedPost`, but `provider` is the
 * extended union above, so a blog crosspost can be represented.
 */
export interface PublishedPost {
  provider: SocialProvider
  uri: string
  cid?: string
  url?: string
}

/** Optional content attached to a post: a link card and/or media. */
export interface PublishContent {
  /** Explicit post title — used by long-form targets (blog); ignored by social providers. */
  title?: string
  external?: {
    uri: string
    title: string
    description?: string
  }
  /**
   * Attached media. Instagram needs a public `url`; Bluesky uploads
   * `bytes` (or fetches `url`) as a blob.
   */
  media?: Array<{
    url?: string
    bytes?: Uint8Array
    mimeType?: string
    altText?: string
  }>
  /** Thread chaining refs — only honored by providers that support replies. */
  reply?: {
    root: { uri: string, cid: string }
    parent: { uri: string, cid: string }
  }
  /**
   * Per-provider body overrides. A provider listed here publishes its own text
   * instead of the shared body; every other provider inherits. Resolved once in
   * `CrosspostService.publishExisting` via `resolveVariantBody`, so drivers
   * never see this field.
   *
   * Exists because networks have wildly different limits (Twitter 280 through
   * blog 10000) and a single body forces the tightest one on all of them.
   */
  variants?: Partial<Record<SocialProvider, string>>
}

/** Outcome of publishing one post to a single provider during a crosspost. */
export interface CrosspostTargetResult {
  provider: SocialProvider
  ok: boolean
  url?: string
  uri?: string
  cid?: string
  targetId?: number
  error?: string
}

/**
 * The narrow surface a bulk purge needs from a provider. Each social service
 * builds one of these so token refresh and identity lookup stay owned by the
 * service that already knows how to do them.
 */
export interface ProviderPurgeAdapter {
  provider: SocialProvider
  identityId: number
  handle: string
  /** One page of the account's own posts; omit the cursor for the first page. */
  listPage: (cursor?: string) => Promise<import('@stacksjs/socials').AuthoredPostPage>
  deletePost: (ref: import('@stacksjs/socials').RemotePostRef) => Promise<void>
}

/**
 * Postline's driver contract. Core's `SocialPublishingDriver` is the same
 * shape minus the two Bluesky session hooks and with core's narrower provider
 * union, so this stays local until session handling moves upstream.
 */
export interface SocialDriver {
  provider: SocialProvider
  characterLimit: number
  createSession?: (credentials: import('@stacksjs/socials').BlueskySessionCredentials) => Promise<import('@stacksjs/socials').BlueskySession>
  refreshSession?: (refreshToken: string) => Promise<import('@stacksjs/socials').BlueskySession>
  publish: (identity: import('@stacksjs/socials').SocialIdentityCredentials, post: PublishPostInput) => Promise<PublishedPost>
  timeline: (identity: import('@stacksjs/socials').SocialIdentityCredentials, query?: import('@stacksjs/socials').TimelineQuery) => Promise<import('@stacksjs/socials').TimelineResult>
}
