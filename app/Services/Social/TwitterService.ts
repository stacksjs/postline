import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, ProviderPurgeAdapter, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { PendingOAuthStates, randomOAuthState } from '../../Support/Social/oauth-state'
import { TwitterApiError, TwitterDriver } from './Drivers/TwitterDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow } from './identities'
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

export class TwitterService {
  private driver = new TwitterDriver()
  // OAuth CSRF state -> PKCE verifier, between the auth redirect and the
  // callback. Keyed by state so two accounts can be connected concurrently.
  private pending = new PendingOAuthStates<{ codeVerifier: string }>()

  private config(): TwitterConfig {
    return {
      clientId: String(env.TWITTER_CLIENT_ID || '').trim(),
      clientSecret: String(env.TWITTER_CLIENT_SECRET || '').trim(),
      redirectUrl: String(env.TWITTER_REDIRECT_URL || '').trim(),
      accessToken: String(env.TWITTER_ACCESS_TOKEN || '').trim(),
      scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    }
  }

  /**
   * The network card's state: top-level fields describe the default account
   * (unchanged for existing callers), `accounts` lists every connected one.
   */
  async status() {
    const rows = await listIdentityRows<SocialIdentityRow>('twitter')
    const identity = pickDefaultIdentity(rows)
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'twitter',
      id: identity ? Number(identity.id) : null,
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      did: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      configuredFromEnv: Boolean(cfg.accessToken),
      oauthConfigured: Boolean(cfg.clientId && cfg.redirectUrl),
      accounts: rows.map(row => toPublicAccount(row, { isDefault: Number(row.id) === Number(identity?.id) })),
    }
  }

  async listAccounts(): Promise<PublicAccount[]> {
    return (await this.status()).accounts
  }

  /** The account a bare `twitter` target publishes through, without connecting anything. */
  async defaultIdentityId(): Promise<number | null> {
    const identity = await findIdentityRow<SocialIdentityRow>('twitter')
    return isUsableIdentity(identity) ? Number(identity!.id) : null
  }

  /** Disconnect one account: tokens dropped, row kept for its posts' history. */
  async disconnect(identityId: number): Promise<PublicAccount> {
    return toPublicAccount(await revokeIdentityRow('twitter', identityId))
  }

  /**
   * Build the X consent URL (with PKCE) and remember the CSRF state + verifier.
   *
   * X signs in whichever account the browser is logged into, so connecting a
   * second account means switching accounts on x.com first; the callback then
   * adds it alongside the first rather than replacing it.
   */
  async getAuthUrl(): Promise<string> {
    const cfg = this.config()
    if (!cfg.clientId) throw new Error('Set TWITTER_CLIENT_ID to connect X/Twitter.')
    if (!cfg.redirectUrl) throw new Error('Set TWITTER_REDIRECT_URL to connect X/Twitter.')

    const state = randomOAuthState()
    const { url, codeVerifier } = await this.driver.createAuthorization({
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state,
    })
    this.pending.issue({ codeVerifier }, state)
    return url
  }

  /** Handle the OAuth redirect: exchange the code and store the tokens. */
  async handleCallback(code: string, state: string) {
    const cfg = this.config()
    if (!code) throw new Error('X/Twitter did not return an authorization code.')
    const pending = this.pending.take(state)
    // Strict either way: without the verifier minted for this exact state the
    // code exchange cannot succeed, so there is no lenient path to keep.
    if (!pending.found && !pending.noneOutstanding) {
      throw new Error('X/Twitter OAuth state mismatch. Please start the connection again.')
    }
    const codeVerifier = pending.value?.codeVerifier
    if (!codeVerifier) throw new Error('Missing PKCE verifier — please start the X/Twitter connection again.')

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

  /**
   * Connect using a pre-obtained token from the environment. `revive: false`
   * is the implicit path (a publish falling back to `.env`), which must not
   * bring back an account the user disconnected.
   */
  async connectFromEnv(options: { revive?: boolean } = {}) {
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
    }, { revive: options.revive ?? true })
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
    identityId?: number | null,
  ): Promise<CrosspostTargetResult> {
    const driver = await this.ensureDriver()

    let identity: SocialIdentityRow
    try {
      identity = await this.requireIdentity(identityId)
    }
    catch (error) {
      return { provider: 'twitter', ok: false, error: messageOf(error), identityId: identityId || undefined }
    }
    const account = { identityId: Number(identity.id), handle: identity.handle }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'twitter',
        ok: false,
        error: `Twitter posts must be ${this.driver.characterLimit} characters or fewer.`,
        ...account,
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
        ...account,
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof TwitterApiError && error.isAuthError) {
        await markIdentityExpired(identity.id)
      }
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'twitter', ok: false, error: message, targetId: Number(target.id), ...account }
    }
  }

  /**
   * The purge surface for X. The identity (and any token refresh) is resolved
   * once up front — X access tokens outlive a single purge run, and refreshing
   * per request would rotate the refresh token on every delete.
   *
   * Pass an identity id to purge one specific account; without one this is the
   * default account, as before.
   */
  async purgeAdapter(identityId?: number | null): Promise<ProviderPurgeAdapter> {
    const identity = await this.requireIdentity(identityId)
    const credentials = {
      handle: identity.handle,
      // `did` carries the numeric X user id the timeline endpoint keys on.
      did: identity.external_id || undefined,
      accessToken: identity.access_token || undefined,
    }

    return {
      provider: 'twitter',
      identityId: Number(identity.id),
      handle: identity.handle,
      listPage: cursor => this.driver.listAuthoredPosts(credentials, { cursor }),
      deletePost: ref => this.driver.deletePost(credentials, ref),
    }
  }

  /**
   * The credentials the DM transport needs, with the same pre-expiry refresh
   * publishing gets. `userId` is what decides whether a `dm_event` was sent by
   * us or to us, so it is required rather than optional here.
   */
  async dmIdentity(identityId?: number | null): Promise<{ identityId: number, accessToken: string, userId: string, handle: string }> {
    const identity = await this.requireIdentity(identityId)
    if (!identity.external_id)
      throw new Error('Reconnect X on the Accounts page — The Open Times needs your user id to tell your own replies apart.')

    return {
      identityId: Number(identity.id),
      accessToken: String(identity.access_token),
      userId: String(identity.external_id),
      handle: identity.handle,
    }
  }

  /**
   * The account to act as. A named account must be usable as-is; without a
   * name this is the default account, falling back to the `.env` token.
   */
  private async requireIdentity(identityId?: number | null): Promise<SocialIdentityRow> {
    if (identityId) {
      const chosen = await findIdentityRow<SocialIdentityRow>('twitter', identityId)
      if (isUsableIdentity(chosen)) return await this.refreshIfExpiring(chosen!)
      throw unavailableAccountError('X', chosen)
    }

    const existing = await findIdentityRow<SocialIdentityRow>('twitter')
    if (isUsableIdentity(existing)) return await this.refreshIfExpiring(existing!)

    if (this.config().accessToken) {
      const connected = await this.connectFromEnv({ revive: false })
      const identity = connected.id ? await findIdentityRow<SocialIdentityRow>('twitter', connected.id) : undefined
      if (identity?.access_token) return identity
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

  /**
   * Save tokens against the account they belong to, keyed on the X user id:
   * reconnecting an account refreshes its row, a different account is added.
   */
  private async saveSession(
    input: { accessToken: string, refreshToken?: string, expiresIn?: number, userId: string, username: string, name?: string },
    options: { revive?: boolean } = {},
  ): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()

    return await upsertIdentityRow<SocialIdentityRow>('twitter', { externalId: input.userId, handle: input.username }, {
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
    }, { revive: options.revive, label: 'This X' })
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
        id: null,
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
      id: Number(row.id),
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
