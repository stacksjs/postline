/**
 * Mastodon publishing driver.
 *
 * The framework's driver does the transport. This subclass adds what Postline
 * needs on top of it:
 *
 * - **An idempotency key.** Mastodon answers a repeated `Idempotency-Key`
 *   with the status it already created. Without one, a publish that reached
 *   the instance but whose answer was lost was sent again by the retry, and
 *   posted twice.
 * - **The instance's own limits.** 500 characters is only the default: an
 *   instance can raise it, and many do. The limit is read from the instance
 *   and remembered for an hour.
 * - **Up to four images**, each with its alt text, where the framework's
 *   publish attached what it was given without a ceiling.
 * - **Visibility, a content warning and a language**, when given.
 */
import type { PublishedPost, PublishPostInput, SocialIdentityCredentials } from '@stacksjs/socials'
import { MastodonApiError, MastodonPublishingDriver, normalizeInstance } from '@stacksjs/socials'
import { fetchRemoteImage } from '../../../Support/Social/image-input'

export { MastodonApiError, MastodonPublishingDriver, normalizeInstance }

export type MastodonVisibility = 'public' | 'unlisted' | 'private' | 'direct'

export interface MastodonPublishOptions {
  /** The same key for the same post to the same account: a retry returns the first status. */
  idempotencyKey?: string
  visibility?: MastodonVisibility
  /** A content warning. The text is hidden behind it. */
  spoilerText?: string
  /** An ISO 639 code, such as `en`. */
  language?: string
}

export interface MastodonLimits {
  characters: number
  /** What a link counts as, whatever its real length. */
  charactersPerUrl: number
  mediaAttachments: number
}

export const MASTODON_DEFAULT_LIMITS: MastodonLimits = { characters: 500, charactersPerUrl: 23, mediaAttachments: 4 }

const LIMITS_TTL_MS = 60 * 60 * 1000

export class MastodonDriver extends MastodonPublishingDriver {
  private readonly limits = new Map<string, { value: MastodonLimits, at: number }>()

  /**
   * The instance's limits, from `/api/v2/instance`. An instance that cannot
   * be reached, or an older one without that endpoint, gets Mastodon's
   * defaults: a publish must not fail because a courtesy lookup did.
   */
  async instanceLimits(identity: SocialIdentityCredentials): Promise<MastodonLimits> {
    const instance = this.instanceOf(identity)
    const cached = this.limits.get(instance)
    if (cached && Date.now() - cached.at < LIMITS_TTL_MS) return cached.value

    let value = MASTODON_DEFAULT_LIMITS
    try {
      const response = await fetch(`${instance}/api/v2/instance`, { signal: AbortSignal.timeout(5_000) })
      if (response.ok) {
        const json = await response.json() as { configuration?: { statuses?: Record<string, unknown>, media_attachments?: Record<string, unknown> } }
        const statuses = json.configuration?.statuses ?? {}
        const positive = (raw: unknown, fallback: number): number => Number(raw) > 0 ? Math.floor(Number(raw)) : fallback
        value = {
          characters: positive(statuses.max_characters, MASTODON_DEFAULT_LIMITS.characters),
          charactersPerUrl: positive(statuses.characters_reserved_per_url, MASTODON_DEFAULT_LIMITS.charactersPerUrl),
          mediaAttachments: positive(statuses.max_media_attachments, MASTODON_DEFAULT_LIMITS.mediaAttachments),
        }
      }
    }
    catch {
      // Unreachable or not JSON: the defaults stand, and are not remembered
      // for the full hour so the real figure is picked up soon.
      this.limits.set(instance, { value, at: Date.now() - LIMITS_TTL_MS + 60_000 })
      return value
    }

    this.limits.set(instance, { value, at: Date.now() })
    return value
  }

  override async publish(identity: SocialIdentityCredentials, post: PublishPostInput, options: MastodonPublishOptions = {}): Promise<PublishedPost> {
    const instance = this.instanceOf(identity)
    const token = this.tokenOf(identity)
    const limits = await this.instanceLimits(identity)

    const mediaIds: string[] = []
    for (const item of (post.media ?? []).slice(0, limits.mediaAttachments)) {
      let bytes = item.bytes
      let mimeType = item.mimeType
      if (!bytes?.length && item.url) {
        const fetched = await fetchRemoteImage(item.url)
        if (!fetched) throw new MastodonApiError(`Postline could not read the image at ${item.url}.`, 422, '')
        bytes = fetched.bytes
        mimeType = fetched.mimeType
      }
      if (bytes?.length)
        mediaIds.push(await this.uploadMedia(identity, bytes, mimeType || 'image/jpeg', item.altText))
    }

    const body: Record<string, unknown> = { status: post.text, visibility: options.visibility ?? 'public' }
    if (mediaIds.length) body.media_ids = mediaIds
    if (post.reply?.parent?.uri) body.in_reply_to_id = post.reply.parent.uri
    if (options.spoilerText?.trim()) body.spoiler_text = options.spoilerText.trim()
    const language = options.language ?? post.langs?.[0]
    if (language) body.language = language

    const headers: Record<string, string> = { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

    const status = await this.request<{ id: string, url?: string, uri?: string }>(`${instance}/api/v1/statuses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    return { provider: this.provider, uri: status.id, cid: status.id, url: status.url || status.uri }
  }
}

/**
 * The key for one post going to one account. It changes with the text, so a
 * post the owner edited after a failure is a new status and not answered
 * with the old one; it does not change between retries of the same text.
 */
export function mastodonIdempotencyKey(postId: number, identityId: number, text: string): string {
  return `postline-${postId}-${identityId}-${Bun.hash(text).toString(36)}`
}
