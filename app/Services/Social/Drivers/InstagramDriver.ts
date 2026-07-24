import { InstagramApiError, InstagramPublishingDriver } from '@stacksjs/socials'

export { InstagramApiError }

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
