/**
 * X/Twitter publishing driver.
 *
 * The framework's driver does auth, deletion and history. This subclass
 * replaces its `publish`, which attached only the first image, sent no alt
 * text, fetched an image address without the guarded fetch, and measured the
 * limit in UTF-16 units where X uses a weighted count.
 */
import type { PublishedPost, PublishPostInput, SocialIdentityCredentials } from '@stacksjs/socials'
import { log } from '@stacksjs/logging'
import { TwitterApiError, TwitterPublishingDriver } from '@stacksjs/socials'
import { exceedsLimit } from '../../../Support/Social/count-text'
import { fetchRemoteImage } from '../../../Support/Social/image-input'

export { TwitterApiError }

export type {
  TwitterAuthUrlInput,
  TwitterDriverOptions,
  TwitterProfile,
  TwitterRefreshInput,
  TwitterToken,
  TwitterTokenExchangeInput,
} from '@stacksjs/socials'

/** X attaches up to four images to a post. */
export const X_MAX_IMAGES = 4
/** X's limit for an image description. */
export const X_MAX_ALT_TEXT = 1000

export class TwitterDriver extends TwitterPublishingDriver {
  /**
   * Describe an uploaded image. Best effort: a post without its alt text is
   * still better than no post, so a refusal here is logged and not thrown.
   */
  async describeMedia(accessToken: string, mediaId: string, altText: string): Promise<boolean> {
    try {
      await this.request(`${this.apiBase}/2/media/metadata`, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: altText.slice(0, X_MAX_ALT_TEXT) } } }),
      })
      return true
    }
    catch (error) {
      log.warn(`[postline] X did not take the alt text for an image: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  override async publish(identity: SocialIdentityCredentials, post: PublishPostInput): Promise<PublishedPost> {
    if (!identity.accessToken) throw new Error('Twitter access token is missing for this identity.')
    if (exceedsLimit('twitter', post.text, this.characterLimit))
      throw new Error(`Twitter posts must be ${this.characterLimit} characters or fewer.`)

    const mediaIds: string[] = []
    for (const item of (post.media ?? []).slice(0, X_MAX_IMAGES)) {
      let bytes = item.bytes
      let mimeType = item.mimeType
      if (!bytes?.length && item.url) {
        const fetched = await fetchRemoteImage(item.url)
        if (!fetched) throw new TwitterApiError(`Postline could not read the image at ${item.url}.`, 422, '')
        bytes = fetched.bytes
        mimeType = fetched.mimeType
      }
      if (!bytes?.length) continue
      const mediaId = await this.uploadMedia(identity.accessToken, bytes, mimeType || 'image/jpeg')
      if (item.altText?.trim()) await this.describeMedia(identity.accessToken, mediaId, item.altText.trim())
      mediaIds.push(mediaId)
    }

    const body: Record<string, unknown> = { text: post.text }
    if (mediaIds.length) body.media = { media_ids: mediaIds }
    if (post.reply?.parent?.uri) body.reply = { in_reply_to_tweet_id: post.reply.parent.uri }

    const created = await this.request<{ data?: { id?: string } }>(`${this.apiBase}/2/tweets`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${identity.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const id = created.data?.id
    if (!id) throw new TwitterApiError('Twitter did not return a tweet id.', 400, JSON.stringify(created))

    return {
      provider: this.provider,
      uri: id,
      cid: id,
      url: identity.handle ? `https://x.com/${identity.handle}/status/${id}` : `https://x.com/i/web/status/${id}`,
    }
  }
}
