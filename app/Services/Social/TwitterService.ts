import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { TwitterApiError, TwitterDriver } from './Drivers/TwitterDriver'
import { ensureAccount, expiresAt, isExpiringSoon, now, uuid } from './support'

const database = db as any

type SocialIdentityRow = {
  id: number
  handle: string
  display_name?: string | null
  provider: 'twitter'
  external_id?: string | null
  auth_status: 'connected' | 'expired' | 'revoked' | 'missing'
  access_token?: string | null
  refresh_token?: string | null
  token_expires_at?: string | null
  account_id?: number | null
  social_driver_id?: number | null
}

type SocialDriverRow = {
  id: number
  provider: 'twitter'
  display_name: string
  status: 'active' | 'planned' | 'disabled'
  character_limit: number
}

interface TwitterConfig {
  clientId: string
  clientSecret: string
  redirectUrl: string
  accessToken: string
  scopes: string[]
}

function randomState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export class TwitterService {
  private driver = new TwitterDriver()
  // OAuth CSRF token + PKCE verifier stashed between the auth redirect and the
  // callback. Postline runs single-user, so module memory is an adequate store.
  private pendingState: string | null = null
  private pendingVerifier: string | null = null

  private config(): TwitterConfig {
    return {
      clientId: String(env.TWITTER_CLIENT_ID || '').trim(),
      clientSecret: String(env.TWITTER_CLIENT_SECRET || '').trim(),
      redirectUrl: String(env.TWITTER_REDIRECT_URL || '').trim(),
      accessToken: String(env.TWITTER_ACCESS_TOKEN || '').trim(),
      scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    }
  }

  async status() {
    const identity = await this.findIdentity()
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'twitter',
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      did: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      configuredFromEnv: Boolean(cfg.accessToken),
      oauthConfigured: Boolean(cfg.clientId && cfg.redirectUrl),
    }
  }

  /** Build the X consent URL (with PKCE) and remember the CSRF state + verifier. */
  async getAuthUrl(): Promise<string> {
    const cfg = this.config()
    if (!cfg.clientId) throw new Error('Set TWITTER_CLIENT_ID to connect X/Twitter.')
    if (!cfg.redirectUrl) throw new Error('Set TWITTER_REDIRECT_URL to connect X/Twitter.')

    this.pendingState = randomState()
    const { url, codeVerifier } = await this.driver.createAuthorization({
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state: this.pendingState,
    })
    this.pendingVerifier = codeVerifier
    return url
  }

  /** Handle the OAuth redirect: exchange the code and store the tokens. */
  async handleCallback(code: string, state: string) {
    const cfg = this.config()
    if (!code) throw new Error('X/Twitter did not return an authorization code.')
    if (this.pendingState && state !== this.pendingState) {
      throw new Error('X/Twitter OAuth state mismatch. Please start the connection again.')
    }
    const codeVerifier = this.pendingVerifier
    if (!codeVerifier) throw new Error('Missing PKCE verifier — please start the X/Twitter connection again.')
    this.pendingState = null
    this.pendingVerifier = null

    const token = await this.driver.exchangeCode({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret || undefined,
      redirectUrl: cfg.redirectUrl,
      code,
      codeVerifier,
    })

    const profile = await this.driver.getProfile(token.accessToken)
    const identity = await this.saveSession({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      userId: profile.id,
      username: profile.username,
      name: profile.name,
    })
    return this.publicIdentity(identity)
  }

  /** Connect using a pre-obtained token from the environment. */
  async connectFromEnv() {
    const cfg = this.config()
    if (!cfg.accessToken) {
      throw new Error('Set TWITTER_ACCESS_TOKEN (or connect via OAuth) before using X/Twitter.')
    }

    const profile = await this.driver.getProfile(cfg.accessToken)
    const identity = await this.saveSession({
      accessToken: cfg.accessToken,
      userId: profile.id,
      username: profile.username,
      name: profile.name,
    })
    return this.publicIdentity(identity)
  }

  /**
   * Publish an already-created post row to X/Twitter. Never throws — failures
   * are recorded on the target and returned so a crosspost to other providers
   * can still succeed.
   */
  async publishToPost(
    post: { id: number, body: string },
    content?: PublishContent,
  ): Promise<CrosspostTargetResult> {
    const driver = await this.ensureDriver()

    let identity: SocialIdentityRow
    try {
      identity = await this.requireIdentity()
    }
    catch (error) {
      return { provider: 'twitter', ok: false, error: messageOf(error) }
    }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'twitter',
        ok: false,
        error: `Twitter posts must be ${this.driver.characterLimit} characters or fewer.`,
      }
    }

    const targetUuid = uuid()
    const createdAt = now()
    await database.insertInto('post_targets').values({
      uuid: targetUuid,
      provider: 'twitter',
      status: 'publishing',
      post_id: post.id,
      social_driver_id: driver.id,
      social_identity_id: identity.id,
      created_at: createdAt,
      updated_at: createdAt,
    }).execute()

    const target = await database
      .selectFrom('post_targets')
      .selectAll()
      .where('uuid', '=', targetUuid)
      .executeTakeFirstOrThrow()

    try {
      const published = await this.driver.publish({
        handle: identity.handle,
        did: identity.external_id || undefined,
        accessToken: identity.access_token || undefined,
      }, {
        text: post.body,
        ...(content?.media?.length ? { media: content.media } : {}),
        ...(content?.reply ? { reply: content.reply } : {}),
      })

      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: published.uri || null,
        remote_cid: published.cid || null,
        failure_reason: null,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return {
        provider: 'twitter',
        ok: true,
        url: published.url,
        uri: published.uri,
        cid: published.cid,
        targetId: Number(target.id),
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof TwitterApiError && error.isAuthError) {
        await this.markExpired(identity.id)
      }
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'twitter', ok: false, error: message, targetId: Number(target.id) }
    }
  }

  private async requireIdentity(): Promise<SocialIdentityRow> {
    const existing = await this.findIdentity()
    if (existing?.access_token && existing.auth_status === 'connected') {
      return await this.refreshIfExpiring(existing)
    }

    if (this.config().accessToken) {
      await this.connectFromEnv()
      const connected = await this.findIdentity()
      if (connected?.access_token) return connected
    }

    throw new Error('Connect X/Twitter before publishing.')
  }

  /**
   * Refresh the access token when it's within its pre-expiry window and a
   * refresh token is on file (present when connected with the `offline.access`
   * scope). Best-effort: any failure leaves the current token in place so a real
   * auth failure still surfaces at publish time.
   */
  private async refreshIfExpiring(identity: SocialIdentityRow): Promise<SocialIdentityRow> {
    const cfg = this.config()
    if (!identity.refresh_token || !isExpiringSoon(identity.token_expires_at)) return identity
    if (!cfg.clientId) return identity

    try {
      const refreshed = await this.driver.refreshAccessToken({
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret || undefined,
        refreshToken: identity.refresh_token,
      })
      const nextExpiry = expiresAt(refreshed.expiresIn)
      // X rotates the refresh token on every refresh — always keep the new one.
      const nextRefresh = refreshed.refreshToken ?? identity.refresh_token
      await database.updateTable('social_identities').set({
        access_token: refreshed.accessToken,
        refresh_token: nextRefresh,
        token_expires_at: nextExpiry,
        auth_status: 'connected',
        updated_at: now(),
      }).where('id', '=', identity.id).execute()

      return { ...identity, access_token: refreshed.accessToken, refresh_token: nextRefresh, token_expires_at: nextExpiry }
    }
    catch {
      return identity
    }
  }

  private async findIdentity(): Promise<SocialIdentityRow | undefined> {
    return await database
      .selectFrom('social_identities')
      .selectAll()
      .where('provider', '=', 'twitter')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst()
  }

  private async saveSession(input: { accessToken: string, refreshToken?: string, expiresIn?: number, userId: string, username: string, name?: string }): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()
    const existing = await this.findIdentity()
    const savedAt = now()

    const values = {
      handle: input.username,
      display_name: input.name || input.username,
      provider: 'twitter',
      external_id: input.userId,
      auth_status: 'connected',
      access_token: input.accessToken,
      refresh_token: input.refreshToken ?? null,
      token_expires_at: expiresAt(input.expiresIn),
      account_id: accountId,
      social_driver_id: driver.id,
      updated_at: savedAt,
    }

    if (existing) {
      await database.updateTable('social_identities').set(values).where('id', '=', existing.id).execute()
    }
    else {
      await database.insertInto('social_identities').values({
        uuid: uuid(),
        ...values,
        created_at: savedAt,
      }).execute()
    }

    return await this.findIdentity() as SocialIdentityRow
  }

  private async markExpired(id: number): Promise<void> {
    await database.updateTable('social_identities').set({
      auth_status: 'expired',
      updated_at: now(),
    }).where('id', '=', id).execute()
  }

  private async ensureDriver(): Promise<SocialDriverRow> {
    const existing = await database
      .selectFrom('social_drivers')
      .selectAll()
      .where('provider', '=', 'twitter')
      .executeTakeFirst()

    if (existing) {
      if (existing.status !== 'active' || existing.character_limit !== this.driver.characterLimit) {
        await database.updateTable('social_drivers').set({
          status: 'active',
          character_limit: this.driver.characterLimit,
          updated_at: now(),
        }).where('id', '=', existing.id).execute()
      }

      return await database
        .selectFrom('social_drivers')
        .selectAll()
        .where('id', '=', existing.id)
        .executeTakeFirstOrThrow()
    }

    const driverUuid = uuid()
    await database.insertInto('social_drivers').values({
      uuid: driverUuid,
      provider: 'twitter',
      display_name: 'X (Twitter)',
      status: 'active',
      character_limit: this.driver.characterLimit,
      capabilities: JSON.stringify({ posts: true, timelines: false, oauth: true }),
      created_at: now(),
      updated_at: now(),
    }).execute()

    return await database
      .selectFrom('social_drivers')
      .selectAll()
      .where('uuid', '=', driverUuid)
      .executeTakeFirstOrThrow()
  }

  private publicIdentity(row: SocialIdentityRow | undefined) {
    if (!row) {
      return {
        connected: false,
        provider: 'twitter',
        handle: null,
        displayName: null,
        did: null,
        authStatus: 'missing',
      }
    }

    const connected = row.auth_status === 'connected' && Boolean(row.access_token)
    return {
      connected,
      provider: 'twitter',
      handle: row.handle,
      displayName: row.display_name || null,
      did: row.external_id || null,
      authStatus: connected ? 'connected' : 'missing',
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const twitter = new TwitterService()
