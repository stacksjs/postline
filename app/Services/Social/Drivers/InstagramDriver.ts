import type { PublishedPost, PublishPostInput, SocialIdentityCredentials } from '@stacksjs/socials'
import { InstagramApiError, InstagramPublishingDriver } from '@stacksjs/socials'
import { exceedsLimit } from '../../../Support/Social/count-text'

export { InstagramApiError }

/** Images per post Postline sends to Instagram. Instagram allows up to ten; four is the composer's limit. */
export const INSTAGRAM_MAX_IMAGES = 4

export interface InstagramLongLivedToken {
  accessToken: string
  expiresIn?: number
}

/**
 * App-owned Instagram driver. Extends the vendored `@stacksjs/socials` driver
 * with the Facebook long-lived-token exchange. Kept in `app/` so a framework
 * upgrade can't clobber it; publishing and account resolution are inherited.
 *
 * Instagram publishes with a Page access token derived from a user token. A
 * Page token minted from a *long-lived* user token does not expire on its own,
 * so the "keep the connection alive" step for Instagram is exchanging the
 * short-lived user token for a long-lived one before resolving the account —
 * there is no per-publish refresh grant the way Threads/LinkedIn have.
 */
export class InstagramDriver extends InstagramPublishingDriver {
  /**
   * Publish a post. The framework driver sent the first image only; this
   * sends two or more as a carousel. Instagram fetches each image from its
   * address, so an image without one is refused rather than left out.
   */
  override async publish(identity: SocialIdentityCredentials, post: PublishPostInput): Promise<PublishedPost> {
    if (!identity.accessToken) throw new Error('Instagram access token is missing for this identity.')
    const userId = identity.did
    if (!userId) throw new Error('Instagram account id is required to publish.')
    const images = (post.media ?? []).slice(0, INSTAGRAM_MAX_IMAGES)
    if (!images.length) throw new Error('Instagram requires an image to post.')
    if (images.some(image => !image.url))
      throw new InstagramApiError('Instagram fetches images from a public address, and this image has none. Set STORAGE_PUBLIC_URL to an address Instagram can reach.', 422, '')
    if (exceedsLimit('instagram', post.text, this.characterLimit))
      throw new Error(`Instagram captions must be ${this.characterLimit} characters or fewer.`)

    const form = { 'content-type': 'application/x-www-form-urlencoded' }
    const create = async (fields: Record<string, string>): Promise<string> => {
      const created = await this.graph<{ id?: string }>(`/${userId}/media`, { method: 'POST', headers: form, body: new URLSearchParams(fields).toString() }, identity.accessToken)
      if (!created.id) throw new InstagramApiError('Instagram did not return a media container id.', 400, JSON.stringify(created))
      return created.id
    }

    let creationId: string
    if (images.length > 1) {
      const children: string[] = []
      for (const image of images) children.push(await create({ image_url: image.url!, is_carousel_item: 'true' }))
      creationId = await create({ media_type: 'CAROUSEL', children: children.join(','), caption: post.text })
    }
    else {
      creationId = await create({ image_url: images[0]!.url!, caption: post.text })
    }

    const published = await this.graph<{ id?: string }>(`/${userId}/media_publish`, { method: 'POST', headers: form, body: new URLSearchParams({ creation_id: creationId }).toString() }, identity.accessToken)
    if (!published.id) throw new InstagramApiError('Instagram did not return a published post id.', 400, JSON.stringify(published))
    const details = await this.graph<{ permalink?: string }>(`/${published.id}?fields=permalink`, { method: 'GET' }, identity.accessToken).catch(() => undefined)
    return { provider: this.provider, uri: published.id, url: details?.permalink }
  }

  /** Exchange a short-lived user token for a long-lived (~60-day) one. */
  async exchangeLongLivedUserToken(clientId: string, clientSecret: string, shortLivedToken: string): Promise<InstagramLongLivedToken> {
    const query = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: shortLivedToken,
    })

    const payload = await this.graph<{ access_token?: string, expires_in?: number }>(
      `/oauth/access_token?${query.toString()}`,
      { method: 'GET' },
    )

    if (!payload.access_token) {
      throw new InstagramApiError('Facebook did not return a long-lived token.', 400, JSON.stringify(payload))
    }

    return { accessToken: payload.access_token, expiresIn: payload.expires_in }
  }
}
