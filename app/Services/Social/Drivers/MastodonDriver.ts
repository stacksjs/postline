import type {
  MastodonAccount,
  MastodonCredentials,
  MastodonPublished,
  MastodonPublishInput,
} from '../../../Support/Social/mastodon'

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
