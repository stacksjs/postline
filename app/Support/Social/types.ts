export type SocialProvider =
  | 'bluesky'
  | 'twitter'
  | 'mastodon'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'linkedin'
  | 'threads'

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

/** Outcome of publishing one post to a single provider during a crosspost. */
export interface CrosspostTargetResult {
  provider: SocialProvider
  ok: boolean
  url?: string
  uri?: string
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

export interface SocialDriver {
  provider: SocialProvider
  characterLimit: number
  createSession?: (credentials: BlueskySessionCredentials) => Promise<BlueskySession>
  refreshSession?: (refreshToken: string) => Promise<BlueskySession>
  publish(identity: SocialIdentityCredentials, post: PublishPostInput): Promise<PublishedPost>
  timeline(identity: SocialIdentityCredentials, query?: TimelineQuery): Promise<TimelineResult>
}
