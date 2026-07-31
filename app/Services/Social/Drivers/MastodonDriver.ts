import type {
  MastodonAccount,
  MastodonCredentials,
  MastodonPublished,
  MastodonPublishInput,
} from '../../../Support/Social/mastodon'
import type { AuthoredPostPage } from '../../../Support/Social/types'

/**
 * Full app-owned Mastodon publishing driver (the published @stacksjs/socials
 * ships none). Talks the Mastodon REST API against the user's chosen
 * instance with a personal access token.
 */

export class MastodonApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message)
    this.name = 'MastodonApiError'
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }
}

/** Normalize "mastodon.social" / "https://mastodon.social/" → "https://mastodon.social". */
export function normalizeInstance(value: string): string {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  if (!trimmed)
    throw new Error('Mastodon instance URL is required.')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return `${url.protocol}//${url.host}`
  }
  catch {
    throw new Error('Mastodon instance URL is invalid.')
  }
}

interface StatusResponse {
  id: string
  url?: string
  uri?: string
}

interface MediaResponse {
  id: string
}

interface AccountResponse {
  id: string
  username: string
  display_name?: string
  url: string
}

export class MastodonPublishingDriver {
  readonly provider: 'mastodon' = 'mastodon'
  // Mastodon's default; instances can raise it, but 500 is the safe floor.
  characterLimit = 500

  /** Verify a token and return the account it belongs to. */
  async verifyCredentials(credentials: MastodonCredentials): Promise<MastodonAccount> {
    const instance = normalizeInstance(credentials.instance)
    if (!credentials.accessToken)
      throw new Error('Mastodon access token is required.')

    const account = await this.request<AccountResponse>(
      `${instance}/api/v1/accounts/verify_credentials`,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } },
    )

    return {
      accountId: account.id,
      username: account.username,
      displayName: account.display_name || undefined,
      url: account.url,
    }
  }

  /** Upload one image and return its media id for attachment. */
  async uploadMedia(credentials: MastodonCredentials, bytes: Uint8Array, mimeType: string, altText?: string): Promise<string> {
    const instance = normalizeInstance(credentials.instance)
    const form = new FormData()
    form.set('file', new Blob([bytes as unknown as BlobPart], { type: mimeType || 'image/jpeg' }), 'upload')
    if (altText) form.set('description', altText)

    const media = await this.request<MediaResponse>(
      `${instance}/api/v2/media`,
      { method: 'POST', headers: { authorization: `Bearer ${credentials.accessToken}` }, body: form },
    )
    return media.id
  }

  async publish(credentials: MastodonCredentials, post: MastodonPublishInput): Promise<MastodonPublished> {
    const instance = normalizeInstance(credentials.instance)
    if (!credentials.accessToken)
      throw new Error('Mastodon access token is required.')
    if (post.text.length > this.characterLimit)
      throw new Error(`Mastodon posts must be ${this.characterLimit} characters or fewer.`)

    const mediaIds: string[] = []
    for (const item of (post.media || []).slice(0, 4)) {
      let bytes = item.bytes
      let mimeType = item.mimeType
      if (!bytes?.length && item.url) {
        const response = await fetch(item.url)
        if (!response.ok) continue
        bytes = new Uint8Array(await response.arrayBuffer())
        mimeType = mimeType || response.headers.get('content-type') || 'image/jpeg'
      }
      if (bytes?.length)
        mediaIds.push(await this.uploadMedia(credentials, bytes, mimeType || 'image/jpeg', item.altText))
    }

    const body: Record<string, unknown> = {
      status: post.text,
      visibility: post.visibility || 'public',
    }
    if (mediaIds.length) body.media_ids = mediaIds
    // Mastodon threads via the parent status id, carried in reply.parent.uri.
    if (post.reply?.parent?.uri) body.in_reply_to_id = post.reply.parent.uri

    const status = await this.request<StatusResponse>(
      `${instance}/api/v1/statuses`,
      {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${credentials.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )

    return {
      provider: 'mastodon',
      // Mastodon uses one status id; expose it as both uri and cid so the
      // crosspost thread-chaining logic (which needs both) can reply-chain.
      uri: status.id,
      cid: status.id,
      url: status.url || status.uri || `${instance}/@me/${status.id}`,
    }
  }

  /**
   * One page of the account's own statuses, newest first. Mastodon paginates
   * by `max_id` (fetch statuses older than the last id seen), so the returned
   * cursor is the oldest id on this page.
   */
  async listAuthoredPosts(
    credentials: MastodonCredentials,
    accountId: string,
    query: { cursor?: string, limit?: number } = {},
  ): Promise<AuthoredPostPage> {
    const instance = normalizeInstance(credentials.instance)
    if (!credentials.accessToken)
      throw new Error('Mastodon access token is required.')
    if (!accountId)
      throw new Error('Mastodon account id is required to list statuses.')

    const url = new URL(`${instance}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses`)
    url.searchParams.set('limit', String(Math.min(Math.max(query.limit || 40, 1), 40)))
    // Exclude boosts: a reblog is not this account's own post to delete.
    url.searchParams.set('exclude_reblogs', 'true')
    if (query.cursor) url.searchParams.set('max_id', query.cursor)

    const statuses = await this.request<Array<{ id: string, content?: string, url?: string, created_at?: string }>>(
      url.toString(),
      { headers: { authorization: `Bearer ${credentials.accessToken}` } },
    )

    const posts = (statuses || []).filter(status => status?.id).map(status => ({
      uri: status.id,
      cid: status.id,
      text: status.content,
      postedAt: status.created_at,
      url: status.url,
    }))

    return {
      // No page means no more history; otherwise resume below the oldest id.
      cursor: posts.length ? posts[posts.length - 1]?.uri : undefined,
      posts,
    }
  }

  /** Permanently delete one status. */
  async deletePost(credentials: MastodonCredentials, statusId: string): Promise<void> {
    const instance = normalizeInstance(credentials.instance)
    if (!credentials.accessToken)
      throw new Error('Mastodon access token is required.')
    const id = String(statusId || '').trim()
    if (!id)
      throw new Error('A status id is required to delete a post.')

    await this.request(
      `${instance}/api/v1/statuses/${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${credentials.accessToken}` } },
    )
  }

  protected async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init)
    const text = await response.text()

    if (!response.ok) {
      throw new MastodonApiError(
        `Mastodon API failed (${response.status}): ${text || response.statusText}`,
        response.status,
        text,
      )
    }

    return text ? JSON.parse(text) as T : {} as T
  }
}

// Consumers import this as `MastodonDriver` (matching the sibling drivers'
// exported name), even though this one is a full local implementation.
export { MastodonPublishingDriver as MastodonDriver }
