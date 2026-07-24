import { ThreadsApiError, ThreadsPublishingDriver } from '@stacksjs/socials'

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
