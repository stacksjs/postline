/**
 * App-owned Mastodon types.
 *
 * The published `@stacksjs/socials` ships no Mastodon driver, so Postline
 * owns this one outright (see ./Services/Social/Drivers/MastodonDriver.ts).
 * Mastodon is token-based: the user creates an access token in their
 * instance's Preferences → Development, and posting is a plain REST call to
 * that instance — no OAuth callback needed.
 */

export interface MastodonCredentials {
  /** Instance base URL, e.g. https://mastodon.social */
  instance: string
  accessToken: string
}

export interface MastodonAccount {
  accountId: string
  username: string
  displayName?: string
  url: string
}

export interface MastodonPublishInput {
  text: string
  media?: Array<{
    url?: string
    bytes?: Uint8Array
    mimeType?: string
    altText?: string
  }>
  /**
   * Thread chaining. The shared PublishContent uses an ATProto shape
   * ({ root, parent } with uri/cid); Mastodon only needs the parent status
   * id, which we carry in `parent.uri`.
   */
  reply?: {
    root: { uri: string, cid: string }
    parent: { uri: string, cid: string }
  }
  visibility?: 'public' | 'unlisted' | 'private' | 'direct'
}

export interface MastodonPublished {
  provider: 'mastodon'
  uri: string
  cid?: string
  url?: string
}
