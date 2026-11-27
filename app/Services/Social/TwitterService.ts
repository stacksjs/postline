import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, ProviderPurgeAdapter, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { PendingOAuthStates, randomOAuthState } from '../../Support/Social/oauth-state'
import { TwitterDriver } from './Drivers/TwitterDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow, saveIdentityTokens } from './identities'
import { refreshOnce } from '../../Support/Social/token-refresh'
import { exceedsLimit } from '../../Support/Social/count-text'
import { ensureAccount, expiresAt, now, uuid } from './support'
import { explainNetworkError } from '../../Support/Social/network-errors'
import { networkApps } from '../NetworkAppService'
import { UserFacingError } from '../../Support/Http/user-error'
import { classifyFailure } from '../../Support/Social/retry'

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

  /**
   * The owner's Twitter app (client id, secret, redirect address): from
   * Settings, else the environment. Read each time, so a change in Settings
   * applies without a restart, in every process.
   */
  private async config(): Promise<TwitterConfig> {
    const app = await networkApps.credentials('twitter')
    return {
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      redirectUrl: app.redirectUrl,
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
    const cfg = (await this.config())
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
    const cfg = (await this.config())
    if (!cfg.clientId) throw new UserFacingError('Add your X app under Settings, Channels first: its client id and secret.')
    if (!cfg.redirectUrl) throw new UserFacingError('Postline could not work out its address for the X redirect. Set it under Settings, Channels.')

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
    const cfg = (await this.config())
    if (!code) throw new Error('X/Twitter did not return an authorization code.')
    const pending = this.pending.take(state)
    // Strict either way: without the verifier minted for this exact state the
    // code exchange cannot succeed, so there is no lenient path to keep.
    if (!pending.found) {
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
    const cfg = (await this.config())
    if (!cfg.accessToken) {
      throw new Error('Connect X in Channels first.')
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

    if (exceedsLimit('twitter', post.body, this.driver.characterLimit)) {
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
      // In words the owner can act on, never the network's raw response. Only
      // a sign-in the network no longer accepts marks the account: a 403 is
      // usually one refused post (a duplicate, a missing permission), and
      // treating it as signed out disconnected accounts that were working.
      const explained = explainNetworkError('twitter', error)
      const message = explained.message
      if (explained.kind === 'expired')
        await markIdentityExpired(identity)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'twitter', ok: false, error: message, targetId: Number(target.id), retry: classifyFailure(error), ...account }
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
   * The account to act as. A named account must be usable as-is; without a
   * name this is the default account, falling back to the `.env` token.
   */
  private async requireIdentity(identityId?: number | null): Promise<SocialIdentityRow> {
    if (identityId) {
      const chosen = await findIdentityRow<SocialIdentityRow>('twitter', identityId)
      const current = isUsableIdentity(chosen) ? await this.refreshIfExpiring(chosen!) : undefined
      if (current) return current
      throw unavailableAccountError('X', chosen)
    }

    const existing = await findIdentityRow<SocialIdentityRow>('twitter')
    if (isUsableIdentity(existing)) {
      const current = await this.refreshIfExpiring(existing!)
      if (current) return current
      throw unavailableAccountError('X', await findIdentityRow<SocialIdentityRow>('twitter', existing!.id))
    }

    if ((await this.config()).accessToken) {
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
  private async refreshIfExpiring(identity: SocialIdentityRow): Promise<SocialIdentityRow | undefined> {
    const cfg = (await this.config())
    if (!identity.refresh_token || !cfg.clientId) return identity

    return await refreshOnce(identity, {
      reload: async () => {
        const row = await findIdentityRow<SocialIdentityRow>('twitter', identity.id)
        return isUsableIdentity(row) ? row : undefined
      },
      refresh: async (current) => {
        const refreshed = await this.driver.refreshAccessToken({
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret || undefined,
          refreshToken: String(current.refresh_token),
        })
        const nextExpiry = expiresAt(refreshed.expiresIn)
        const nextRefresh = refreshed.refreshToken ?? current.refresh_token
        return await saveIdentityTokens(current, {
          access_token: refreshed.accessToken,
          refresh_token: nextRefresh,
          token_expires_at: nextExpiry,
          auth_status: 'connected',
          updated_at: now(),
        })
      },
      refused: async current => await markIdentityExpired(current),
    })
  }

  /**
   * Renew every connected account's token that is close to expiry. Run daily
   * by `KeepTokensAlive`, so an account nobody posts from stays connected.
   */
  async keepAlive(): Promise<number> {
    const rows = await listIdentityRows<SocialIdentityRow>('twitter')
    let renewed = 0
    for (const row of rows.filter(row => isUsableIdentity(row))) {
      const after = await this.refreshIfExpiring(row)
      if (after && after.token_expires_at !== row.token_expires_at) renewed++
    }
    return renewed
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
