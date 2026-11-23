import type { PublishedPost, PublishPostInput, SocialIdentityCredentials } from '@stacksjs/socials'
import { ThreadsApiError, ThreadsPublishingDriver } from '@stacksjs/socials'
import { exceedsLimit } from '../../../Support/Social/count-text'

export { ThreadsApiError }

export interface ThreadsLongLivedToken {
  accessToken: string
  expiresIn?: number
}

/**
 * App-owned Threads driver. Extends the vendored `@stacksjs/socials` driver with
 * long-lived-token exchange and refresh — the base driver's `exchangeCode` only
 * mints a short-lived (~1h) token. Kept in `app/` so a framework upgrade can't
 * clobber it; publishing and timeline are inherited unchanged.
 *
 * Both token endpoints are unversioned (no `/vX` prefix), so they can't go
 * through the base `graph()` helper — they use a small local `tokenRequest`.
 */
export class ThreadsDriver extends ThreadsPublishingDriver {
  /**
   * Publish one post, as a reply when it continues a thread.
   *
   * The framework driver has no notion of a reply and returns no `cid`, so
   * every segment of a thread went out as a separate post. This sends
   * `reply_to_id` for a later segment and returns the post id as both `uri`
   * and `cid`, which is what `advanceChain` needs to chain the next one.
   * It also counts the way Threads does instead of in UTF-16 units.
   */
  override async publish(identity: SocialIdentityCredentials, post: PublishPostInput): Promise<PublishedPost> {
    if (!identity.accessToken) throw new Error('Threads access token is missing for this identity.')
    const userId = identity.did
    if (!userId) throw new Error('Threads account id is required to publish.')
    if (exceedsLimit('threads', post.text, this.characterLimit))
      throw new Error(`Threads posts must be ${this.characterLimit} characters or fewer.`)

    const form = { 'content-type': 'application/x-www-form-urlencoded' }
    const container = new URLSearchParams({ text: post.text })
    const image = post.media?.[0]
    if (image?.url) {
      container.set('media_type', 'IMAGE')
      container.set('image_url', image.url)
      if (image.altText) container.set('alt_text', image.altText)
    }
    else {
      container.set('media_type', 'TEXT')
    }
    const parent = post.reply?.parent?.uri
    if (parent) container.set('reply_to_id', parent)

    const created = await this.graph<{ id?: string }>(`/${userId}/threads`, { method: 'POST', headers: form, body: container.toString() }, identity.accessToken)
    if (!created.id) throw new ThreadsApiError('Threads did not return a media container id.', 400, JSON.stringify(created))

    const published = await this.graph<{ id?: string }>(`/${userId}/threads_publish`, { method: 'POST', headers: form, body: new URLSearchParams({ creation_id: created.id }).toString() }, identity.accessToken)
    if (!published.id) throw new ThreadsApiError('Threads did not return a published post id.', 400, JSON.stringify(published))

    const details = await this.graph<{ permalink?: string }>(`/${published.id}?fields=permalink`, { method: 'GET' }, identity.accessToken).catch(() => undefined)
    return { provider: this.provider, uri: published.id, cid: published.id, url: details?.permalink }
  }

  /**
   * Exchange a short-lived token for a long-lived (~60-day) one. Requires the
   * app's client secret. Called once right after the OAuth code exchange.
   */
  async exchangeLongLivedToken(clientSecret: string, shortLivedToken: string): Promise<ThreadsLongLivedToken> {
    const query = new URLSearchParams({
      grant_type: 'th_exchange_token',
      client_secret: clientSecret,
      access_token: shortLivedToken,
    })
    const payload = await this.tokenRequest(`${this.graphBase}/access_token?${query.toString()}`)
    return { accessToken: payload.access_token, expiresIn: payload.expires_in }
  }

  /**
   * Refresh an unexpired long-lived token, extending it another ~60 days.
   * Threads requires the token be at least 24h old and not yet expired — both
   * hold when the proactive refresh fires inside the pre-expiry window.
   */
  async refreshLongLivedToken(accessToken: string): Promise<ThreadsLongLivedToken> {
    const query = new URLSearchParams({
      grant_type: 'th_refresh_token',
      access_token: accessToken,
    })
    const payload = await this.tokenRequest(`${this.graphBase}/refresh_access_token?${query.toString()}`)
    return { accessToken: payload.access_token, expiresIn: payload.expires_in }
  }

  private async tokenRequest(url: string): Promise<{ access_token: string, expires_in?: number }> {
    const response = await fetch(url, { method: 'GET' })
    const text = await response.text()
    let json: any = {}
    try {
      json = text ? JSON.parse(text) : {}
    }
    catch {
      json = {}
    }

    if (!response.ok || json?.error || !json?.access_token) {
      const message = json?.error?.message || json?.error_message || text || response.statusText
      throw new ThreadsApiError(`Threads token request failed (${response.status}): ${message}`, response.status, text)
    }

    return json
  }
}
