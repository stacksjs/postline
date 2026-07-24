import type { LinkedInTokenExchangeInput, PublishedPost, PublishPostInput, SocialIdentityCredentials } from '@stacksjs/socials'
import { escapeLinkedInText, LinkedInApiError, LinkedInPublishingDriver } from '@stacksjs/socials'

export { LinkedInApiError }

interface InitializeUploadResponse {
  value?: { uploadUrl?: string, image?: string }
}

export interface LinkedInRefreshInput {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export interface LinkedInRefreshedToken {
  accessToken: string
  expiresIn?: number
  /** Present only when the app is enrolled in LinkedIn's refresh-token program. */
  refreshToken?: string
  refreshTokenExpiresIn?: number
}

/**
 * App-owned LinkedIn driver. Extends the vendored `@stacksjs/socials` driver to
 * add image posting — the base driver only supports text and article link
 * cards. Kept here in `app/` (not patched into `storage/framework/`) so a
 * framework upgrade can't clobber it, the same "re-home into app code" rule the
 * app-owned Mastodon driver and the auth bridge follow.
 *
 * Everything else (OAuth `getAuthUrl`/`exchangeCode`/`getProfile`, the versioned
 * REST plumbing) is inherited unchanged. Only `publish` is overridden, and a
 * single `uploadImage` step is added.
 */
export class LinkedInDriver extends LinkedInPublishingDriver {
  /**
   * Exchange an authorization code for a token, additionally surfacing the
   * `refresh_token` the base driver drops. LinkedIn only returns one when the
   * app is enrolled in the refresh-token program; when absent, the field is
   * simply undefined and the connection falls back to reconnect-on-expiry.
   */
  async exchangeCode(input: LinkedInTokenExchangeInput): Promise<LinkedInRefreshedToken & { scope?: string }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUrl,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    })

    const payload = await this.request<{
      access_token: string
      expires_in?: number
      scope?: string
      refresh_token?: string
      refresh_token_expires_in?: number
    }>(`${this.authBase}/oauth/v2/accessToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!payload.access_token) {
      throw new LinkedInApiError('LinkedIn did not return an access token.', 400, JSON.stringify(payload))
    }

    return {
      accessToken: payload.access_token,
      expiresIn: payload.expires_in,
      scope: payload.scope,
      refreshToken: payload.refresh_token,
      refreshTokenExpiresIn: payload.refresh_token_expires_in,
    }
  }

  /** Mint a fresh access token from a stored refresh token. */
  async refreshAccessToken(input: LinkedInRefreshInput): Promise<LinkedInRefreshedToken> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    })

    const payload = await this.request<{
      access_token: string
      expires_in?: number
      refresh_token?: string
      refresh_token_expires_in?: number
    }>(`${this.authBase}/oauth/v2/accessToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!payload.access_token) {
      throw new LinkedInApiError('LinkedIn did not return a refreshed access token.', 400, JSON.stringify(payload))
    }

    return {
      accessToken: payload.access_token,
      expiresIn: payload.expires_in,
      refreshToken: payload.refresh_token,
      refreshTokenExpiresIn: payload.refresh_token_expires_in,
    }
  }

  /**
   * Register and upload one image via LinkedIn's versioned Images API, then
   * return its `urn:li:image:...` id for attachment.
   *
   *   1. POST /rest/images?action=initializeUpload → { uploadUrl, image URN }
   *   2. PUT the raw bytes to `uploadUrl`
   *
   * `owner` is the author URN (`urn:li:person:{sub}`) that owns the asset.
   */
  async uploadImage(accessToken: string, owner: string, bytes: Uint8Array, mimeType?: string): Promise<string> {
    const initialized = await this.request<InitializeUploadResponse>(
      `${this.apiBase}/rest/images?action=initializeUpload`,
      {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'linkedin-version': this.apiVersion,
          'x-restli-protocol-version': '2.0.0',
        },
        body: JSON.stringify({ initializeUploadRequest: { owner } }),
      },
    )

    const uploadUrl = initialized.value?.uploadUrl
    const image = initialized.value?.image
    if (!uploadUrl || !image) {
      throw new LinkedInApiError('LinkedIn did not return an image upload URL.', 400, JSON.stringify(initialized))
    }

    const upload = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'authorization': `Bearer ${accessToken}`,
        'content-type': mimeType || 'image/jpeg',
      },
      body: bytes as unknown as BodyInit,
    })

    if (!upload.ok) {
      const text = await upload.text().catch(() => '')
      throw new LinkedInApiError(
        `LinkedIn image upload failed (${upload.status}): ${text || upload.statusText}`,
        upload.status,
        text,
      )
    }

    return image
  }

  /**
   * Publish a member share. Extends the base text/article flow with a single
   * attached image (`post.media[0]`): the image is uploaded first, then
   * referenced under `content.media`. LinkedIn's `content` is a one-of, so an
   * image supersedes an article link card when both are present (matching how
   * Bluesky lets an image override the link card).
   *
   * The record shape is duplicated from the base driver by necessity — the base
   * `publish` builds it inline with no seam to inject media — and is pinned by
   * tests/unit/linkedin-driver.test.ts so upgrade drift surfaces immediately.
   */
  async publish(identity: SocialIdentityCredentials, post: PublishPostInput): Promise<PublishedPost> {
    if (!identity.accessToken) throw new Error('LinkedIn access token is missing for this identity.')

    // `did` carries the member URN (urn:li:person:{sub}) for LinkedIn identities.
    const author = identity.did
    if (!author) throw new Error('LinkedIn member URN is required to publish.')

    if (post.text.length > this.characterLimit) {
      throw new Error(`LinkedIn posts must be ${this.characterLimit} characters or fewer.`)
    }

    // Resolve an attached image to bytes — uploaded files arrive as `bytes`;
    // a bare `url` is fetched first (same handling as the Mastodon driver).
    const media = post.media?.[0]
    let imageUrn: string | undefined
    if (media) {
      let bytes = media.bytes
      let mimeType = media.mimeType
      if (!bytes?.length && media.url) {
        const response = await fetch(media.url)
        if (response.ok) {
          bytes = new Uint8Array(await response.arrayBuffer())
          mimeType = mimeType || response.headers.get('content-type') || 'image/jpeg'
        }
      }
      if (bytes?.length) {
        imageUrn = await this.uploadImage(identity.accessToken, author, bytes, mimeType)
      }
    }

    const record: Record<string, unknown> = {
      author,
      commentary: escapeLinkedInText(post.text),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }

    if (imageUrn) {
      record.content = {
        media: {
          id: imageUrn,
          ...(media?.altText ? { altText: media.altText } : {}),
        },
      }
    }
    else if (post.external) {
      record.content = {
        article: {
          source: post.external.uri,
          title: post.external.title,
          description: post.external.description || '',
        },
      }
    }

    const response = await fetch(`${this.apiBase}/rest/posts`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${identity.accessToken}`,
        'content-type': 'application/json',
        'linkedin-version': this.apiVersion,
        'x-restli-protocol-version': '2.0.0',
      },
      body: JSON.stringify(record),
    })

    const text = await response.text()
    if (!response.ok) {
      throw new LinkedInApiError(
        `LinkedIn API failed (${response.status}): ${text || response.statusText}`,
        response.status,
        text,
      )
    }

    // The created post URN comes back in a response header, not the body.
    const uri = response.headers.get('x-restli-id')
      || response.headers.get('x-linkedin-id')
      || ''

    return {
      provider: this.provider,
      uri,
      url: uri ? `https://www.linkedin.com/feed/update/${uri}` : undefined,
    }
  }
}
