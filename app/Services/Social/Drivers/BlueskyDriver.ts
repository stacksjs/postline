import type {
  PublishPostInput,
  PublishedPost,
  SocialDriver,
  SocialIdentityCredentials,
  TimelineQuery,
  TimelineResult,
} from '../../../Support/Social/types'

const ATPROTO_SERVICE = 'https://bsky.social'

export class BlueskyDriver implements SocialDriver {
  provider = 'bluesky' as const
  characterLimit = 300

  async publish(identity: SocialIdentityCredentials, post: PublishPostInput): Promise<PublishedPost> {
    if (!identity.accessToken) {
      throw new Error('Bluesky access token is missing for this identity.')
    }

    if (post.text.length > this.characterLimit) {
      throw new Error(`Bluesky posts must be ${this.characterLimit} characters or fewer.`)
    }

    const createdAt = post.scheduledAt || new Date().toISOString()
    const response = await fetch(`${ATPROTO_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${identity.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repo: identity.handle,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: post.text,
          createdAt,
        },
      }),
    })

    if (!response.ok) {
      const details = await response.text()
      throw new Error(`Bluesky publish failed (${response.status}): ${details}`)
    }

    const payload = await response.json() as { uri: string, cid?: string }

    return {
      provider: this.provider,
      uri: payload.uri,
      cid: payload.cid,
      url: this.toPostUrl(identity.handle, payload.uri),
    }
  }

  async timeline(identity: SocialIdentityCredentials, query: TimelineQuery = {}): Promise<TimelineResult> {
    if (!identity.accessToken) {
      throw new Error('Bluesky access token is missing for this identity.')
    }

    const url = new URL(`${ATPROTO_SERVICE}/xrpc/app.bsky.feed.getTimeline`)
    url.searchParams.set('limit', String(query.limit || 30))
    if (query.cursor) url.searchParams.set('cursor', query.cursor)

    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${identity.accessToken}`,
      },
    })

    if (!response.ok) {
      const details = await response.text()
      throw new Error(`Bluesky timeline failed (${response.status}): ${details}`)
    }

    const payload = await response.json() as {
      cursor?: string
      feed?: Array<{
        post?: {
          uri: string
          author?: { handle: string, displayName?: string }
          record?: { text?: string, createdAt?: string }
          likeCount?: number
          repostCount?: number
          replyCount?: number
        }
      }>
    }

    return {
      cursor: payload.cursor,
      items: (payload.feed || []).flatMap((entry) => {
        const item = entry.post
        if (!item?.uri || !item.author?.handle) return []

        return [{
          uri: item.uri,
          authorHandle: item.author.handle,
          authorName: item.author.displayName,
          body: item.record?.text || '',
          postedAt: item.record?.createdAt || new Date().toISOString(),
          likeCount: item.likeCount || 0,
          repostCount: item.repostCount || 0,
          replyCount: item.replyCount || 0,
        }]
      }),
    }
  }

  private toPostUrl(handle: string, uri: string): string {
    const postId = uri.split('/').pop()
    return `https://bsky.app/profile/${handle}/post/${postId}`
  }
}
