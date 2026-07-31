import type { SocialIdentityCredentials } from '@stacksjs/socials'
import type { AuthoredPostPage } from '../../../Support/Social/types'
import { BlueskyPublishingDriver } from '@stacksjs/socials'

export { BlueskyApiError } from '@stacksjs/socials'

const POST_COLLECTION = 'app.bsky.feed.post'

/**
 * Split `at://<repo>/<collection>/<rkey>` into its parts. Bluesky deletes are
 * keyed by repo + collection + rkey, not by the AT-URI itself.
 */
export function parseAtUri(uri: string): { repo: string, collection: string, rkey: string } {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(String(uri || '').trim())
  if (!match) throw new Error(`"${uri}" is not a Bluesky post URI.`)
  return { repo: match[1] as string, collection: match[2] as string, rkey: match[3] as string }
}

/**
 * The published `@stacksjs/socials` driver publishes and reads, but never
 * deletes. This subclass adds the two repo operations a bulk purge needs:
 * enumerating the account's own posts and removing one by URI.
 */
export class BlueskyPurgeCapableDriver extends BlueskyPublishingDriver {
  /**
   * One page of the account's own `app.bsky.feed.post` records, newest first.
   * `com.atproto.repo.listRecords` reads the repo directly, so it returns
   * everything the account ever posted — not just what Postline published.
   */
  async listAuthoredPosts(
    identity: SocialIdentityCredentials,
    query: { cursor?: string, limit?: number } = {},
  ): Promise<AuthoredPostPage> {
    const repo = identity.did || identity.handle
    if (!identity.accessToken) throw new Error('Bluesky access token is missing for this identity.')
    if (!repo) throw new Error('Bluesky identity DID or handle is required.')

    const url = new URL(`${this.service}/xrpc/com.atproto.repo.listRecords`)
    url.searchParams.set('repo', repo)
    url.searchParams.set('collection', POST_COLLECTION)
    url.searchParams.set('limit', String(Math.min(Math.max(query.limit || 100, 1), 100)))
    if (query.cursor) url.searchParams.set('cursor', query.cursor)

    const payload = await this.request<{
      cursor?: string
      records?: Array<{ uri: string, cid?: string, value?: { text?: string, createdAt?: string } }>
    }>(url, { headers: { authorization: `Bearer ${identity.accessToken}` } })

    return {
      cursor: payload.cursor,
      posts: (payload.records || []).filter(record => record?.uri).map(record => ({
        uri: record.uri,
        cid: record.cid,
        text: record.value?.text,
        postedAt: record.value?.createdAt,
        url: identity.handle ? this.toPostUrl(identity.handle, record.uri) : undefined,
      })),
    }
  }

  /** Permanently delete one post record from the account's repo. */
  async deletePost(identity: SocialIdentityCredentials, uri: string): Promise<void> {
    if (!identity.accessToken) throw new Error('Bluesky access token is missing for this identity.')
    const { repo, collection, rkey } = parseAtUri(uri)

    await this.post(
      '/xrpc/com.atproto.repo.deleteRecord',
      { repo, collection, rkey },
      { authorization: `Bearer ${identity.accessToken}` },
    )
  }
}

// Consumers import this as `BlueskyDriver`, matching the sibling drivers.
export { BlueskyPurgeCapableDriver as BlueskyDriver }
