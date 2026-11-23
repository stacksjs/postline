/**
 * Bluesky publishing driver.
 *
 * The framework's driver does the transport: sessions, timelines, metrics,
 * deletion. This subclass replaces its `publish` for three reasons:
 *
 * - It measured the limit in UTF-16 units. Bluesky counts graphemes, so a
 *   post of 200 emoji, well within 300, was refused before it was sent.
 * - A link card went out without its picture. The thumbnail has to be
 *   uploaded and attached; a card without one is a grey box.
 * - Post languages were never sent.
 *
 * One driver talks to one server. `BlueskyService` keeps a driver per
 * account server (see `bluesky-server.ts`).
 */
import type { PublishedPost, PublishPostInput, SocialIdentityCredentials } from '@stacksjs/socials'
import { BlueskyApiError, BlueskyPublishingDriver, parseAtUri } from '@stacksjs/socials'
import { exceedsLimit } from '../../../Support/Social/count-text'

export { BlueskyApiError, parseAtUri }

/** Bluesky refuses a blob over this size. */
export const BLUESKY_MAX_BLOB_BYTES = 1_000_000

export interface BlueskyPublishInput extends PublishPostInput {
  external?: PublishPostInput['external'] & {
    /** The card's picture, already fetched. Left off the card when too large. */
    thumb?: { bytes: Uint8Array, mimeType: string }
  }
}

export class BlueskyDriver extends BlueskyPublishingDriver {
  override async publish(identity: SocialIdentityCredentials, post: BlueskyPublishInput): Promise<PublishedPost> {
    if (!identity.accessToken) throw new Error('Bluesky access token is missing for this identity.')
    const repo = identity.did || identity.handle
    if (!repo) throw new Error('Bluesky identity DID or handle is required.')
    if (exceedsLimit('bluesky', post.text, this.characterLimit))
      throw new Error(`Bluesky posts must be ${this.characterLimit} characters or fewer.`)

    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text: post.text,
      createdAt: post.scheduledAt || new Date().toISOString(),
    }
    if (post.langs?.length) record.langs = post.langs.slice(0, 3)
    if (post.reply) record.reply = post.reply
    const facets = post.facets ?? await this.buildFacets(post.text)
    if (facets.length) record.facets = facets

    const images = (post.media || []).filter(item => item.bytes?.length).slice(0, 4)
    if (images.length) {
      // Bluesky allows images or a link card on a post, not both. The images
      // win: they are what the author attached on purpose.
      const uploaded: Array<{ image: unknown, alt: string }> = []
      for (const item of images)
        uploaded.push({ image: await this.uploadBlob(identity, item.bytes!, item.mimeType || 'image/jpeg'), alt: item.altText || '' })
      record.embed = { $type: 'app.bsky.embed.images', images: uploaded }
    }
    else if (post.external) {
      const external: Record<string, unknown> = {
        uri: post.external.uri,
        title: post.external.title,
        description: post.external.description || '',
      }
      const thumb = post.external.thumb
      if (thumb?.bytes?.length && thumb.bytes.length <= BLUESKY_MAX_BLOB_BYTES) {
        try {
          external.thumb = await this.uploadBlob(identity, thumb.bytes, thumb.mimeType)
        }
        catch {
          // The card still goes out, without its picture: better than no post.
        }
      }
      record.embed = { $type: 'app.bsky.embed.external', external }
    }

    const created = await this.post<{ uri: string, cid: string }>('/xrpc/com.atproto.repo.createRecord', {
      repo,
      collection: 'app.bsky.feed.post',
      record,
    }, { authorization: `Bearer ${identity.accessToken}` })

    return { provider: this.provider, uri: created.uri, cid: created.cid, url: this.toPostUrl(identity.handle, created.uri) }
  }
}

/**
 * Whether an error means the session is no longer good. The framework counts
 * every 400 as one, so a post Bluesky rejected as invalid triggered a session
 * refresh and could mark a healthy account as expired. A 400 is a session
 * problem only when Bluesky says so by name.
 */
export function isBlueskySessionError(error: unknown): boolean {
  if (!(error instanceof BlueskyApiError)) return false
  if (error.status === 401) return true
  if (error.status !== 400) return false
  try {
    return ['ExpiredToken', 'InvalidToken'].includes(String(JSON.parse(error.body)?.error))
  }
  catch {
    return false
  }
}
