export type SocialProvider =
  | 'bluesky'
  | 'twitter'
  | 'mastodon'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'linkedin'
  | 'threads'
  | 'blog'

export interface SocialIdentityCredentials {
  handle: string
  did?: string
  accessToken?: string
  refreshToken?: string
}

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

/**
 * One post the connected account authored, as returned when enumerating an
 * account's own history for a purge. `uri` is whatever the provider's delete
 * endpoint keys on (an AT-URI on Bluesky, a numeric id on X/Mastodon).
 */
export interface AuthoredPost {
  uri: string
  cid?: string
  text?: string
  postedAt?: string
  url?: string
}

/** A page of authored posts plus the cursor for the next page (if any). */
export interface AuthoredPostPage {
  cursor?: string
  posts: AuthoredPost[]
}

/** The minimum a purge needs to identify one remote post for deletion. */
export interface RemotePostRef {
  uri: string
  cid?: string
}

export interface SocialDriver {
  provider: SocialProvider
  characterLimit: number
  createSession?: (credentials: BlueskySessionCredentials) => Promise<BlueskySession>
  refreshSession?: (refreshToken: string) => Promise<BlueskySession>
  publish(identity: SocialIdentityCredentials, post: PublishPostInput): Promise<PublishedPost>
  timeline(identity: SocialIdentityCredentials, query?: TimelineQuery): Promise<TimelineResult>
}
