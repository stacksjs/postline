/**
 * App-owned Bluesky types.
 *
 * Postline extends the ATProto publish surface well past the published
 * `@stacksjs/socials` driver: reply-chained threads, rich-text facets,
 * image blob embeds, and engagement metrics. Those enhancements used to
 * live as edits to the vendored framework package; now that the framework
 * is a node_modules dependency, the app owns its Bluesky driver and these
 * types outright (see ./Drivers/BlueskyDriver.ts).
 */

export interface BlueskySessionCredentials {
  identifier: string
  password: string
}

export interface BlueskySession {
  did: string
  handle: string
  displayName?: string
  accessJwt: string
  refreshJwt: string
}

export interface SocialIdentityCredentials {
  handle: string
  did?: string
  accessToken?: string
  refreshToken?: string
}

export interface PublishPostInput {
  text: string
  scheduledAt?: string
  langs?: string[]
  external?: {
    uri: string
    title: string
    description?: string
  }
  /**
   * Reply references for thread chaining (ATProto shape). `root` is the
   * first post of the thread, `parent` the one directly above.
   */
  reply?: {
    root: { uri: string, cid: string }
    parent: { uri: string, cid: string }
  }
  /**
   * Attached media. Instagram requires a public `url`; Bluesky uploads
   * `bytes` (or fetches `url`) as a blob and embeds the images.
   */
  media?: Array<{
    url?: string
    bytes?: Uint8Array
    mimeType?: string
    altText?: string
  }>
  /**
   * Precomputed rich-text facets (ATProto shape). When omitted, the
   * driver detects links/mentions/hashtags automatically.
   */
  facets?: unknown[]
}

export interface PublishedPost {
  provider: 'bluesky'
  uri: string
  cid?: string
  url?: string
}

export interface TimelineQuery {
  cursor?: string
  limit?: number
}

export interface TimelineResult {
  cursor?: string
  items: Array<{
    uri: string
    authorHandle: string
    authorName?: string
    authorAvatar?: string
    postUrl?: string
    body: string
    postedAt: string
    likeCount: number
    repostCount: number
    replyCount: number
  }>
}

export interface SocialPublishingDriver {
  provider: 'bluesky'
  characterLimit: number
  publish: (identity: SocialIdentityCredentials, post: PublishPostInput) => Promise<PublishedPost>
  timeline: (identity: SocialIdentityCredentials, query?: TimelineQuery) => Promise<TimelineResult>
}
