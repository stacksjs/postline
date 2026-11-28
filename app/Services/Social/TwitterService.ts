import type { NetworkOAuthExchangeOptions } from '../../Support/Social/network-oauth'
import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, ProviderPurgeAdapter, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { TwitterApiError, TwitterDriver } from './Drivers/TwitterDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow, saveIdentityTokens } from './identities'
import { refreshOnce } from '../../Support/Social/token-refresh'
import { exceedsLimit } from '../../Support/Social/count-text'
import { ensureAccount, expiresAt, now, uuid } from './support'
import { explainNetworkError } from '../../Support/Social/network-errors'
import { networkApps } from '../NetworkAppService'
import { UserFacingError } from '../../Support/Http/user-error'
import { classifyFailure } from '../../Support/Social/retry'
import { TWITTER_READ_PRICE, withTwitterReadBudget } from './TwitterReadBudget'
import { syncConnectedMetrics } from './sync-connected-metrics'
import { supportsLocalTwitterBrowser, twitterBrowserPublishingAccounts } from './TwitterBrowserSession'
import { twitterBrowserDispatch } from './TwitterBrowserDispatchService'

const database = db as any

type SocialIdentityRow = {
  id: number
  handle: string
  display_name?: string | null
  provider: 'twitter'
  external_id?: string | null
  auth_transport?: 'api' | 'browser' | null
  auth_status: 'connected' | 'expired' | 'revoked' | 'missing'
  access_token?: string | null
  refresh_token?: string | null
  token_expires_at?: string | null
  account_id?: number | null
  social_driver_id?: number | null
  twitter_dm_consent?: boolean | number | null
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
  directMessages: boolean
}

function hasDirectMessageScopes(scope: string): boolean {
  const granted = new Set(scope.split(/\s+/))
  return granted.has('dm.read') && granted.has('dm.write')
}

export class TwitterService {
  private driver = new TwitterDriver()

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
      scopes: ['tweet.read', 'tweet.write', 'media.write', 'users.read', 'offline.access', ...(app.directMessages ? ['dm.read', 'dm.write'] : [])],
      directMessages: app.directMessages,
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
      accounts: [
        ...rows.map(row => toPublicAccount(row, { isDefault: Number(row.id) === Number(identity?.id) })),
        ...await twitterBrowserPublishingAccounts(),
      ],
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
   * Build the X consent URL and its PKCE verifier for the browser-bound flow.
   *
   * X signs in whichever account the browser is logged into, so connecting a
   * second account means switching accounts on x.com first; the callback then
   * adds it alongside the first rather than replacing it.
   */
  async prepareAuthorization(): Promise<{ url: string, codeVerifier: string, requestedScopes: string[] }> {
    const cfg = (await this.config())
    if (!cfg.clientId) throw new UserFacingError('Add your X app under Settings, Channels first: its client id and secret.')
    if (!cfg.redirectUrl) throw new UserFacingError('Postline could not work out its address for the X redirect. Set it under Settings, Channels.')

    const authorization = await this.driver.createAuthorization({
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state: '',
    })
    return { ...authorization, requestedScopes: cfg.scopes }
  }

  /** Handle the OAuth redirect: exchange the code and store the tokens. */
  async exchangeAuthorizationCode(code: string, { codeVerifier, testOnly, requestedScopes }: NetworkOAuthExchangeOptions = {}) {
    const cfg = (await this.config())
    if (!code) throw new Error('X/Twitter did not return an authorization code.')
    if (!codeVerifier) throw new UserFacingError('Start a new X connection from Channels to continue.')

    const token = await this.driver.exchangeCode({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret || undefined,
      redirectUrl: cfg.redirectUrl,
      code,
      codeVerifier,
    })

    const profile = await this.readProfile(token.accessToken)
    if (testOnly) return
    const identity = await this.saveSession({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      userId: profile.id,
      username: profile.username,
      name: profile.name,
      directMessages: hasDirectMessageScopes(token.scope ?? requestedScopes?.join(' ') ?? ''),
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

    const profile = await this.readProfile(cfg.accessToken)
    const identity = await this.saveSession({
      accessToken: cfg.accessToken,
      userId: profile.id,
      username: profile.username,
      name: profile.name,
      directMessages: cfg.directMessages,
    }, { revive: options.revive ?? true })
    return this.publicIdentity(identity)
  }

  private async readProfile(accessToken: string) {
    return await withTwitterReadBudget(TWITTER_READ_PRICE.user, async () => ({
      value: await this.driver.getProfile(accessToken),
      estimatedMicros: TWITTER_READ_PRICE.user,
    }))
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
      const chosen = identityId ? await findIdentityRow<SocialIdentityRow>('twitter', identityId) : null
      if (chosen?.auth_transport === 'browser') {
        if (!supportsLocalTwitterBrowser() || chosen.auth_status === 'revoked')
          throw new UserFacingError('Publish through this X browser account in the Postline Mac app.')
        identity = chosen
      }
      else {
        identity = await this.requireIdentity(identityId)
      }
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
      const published = identity.auth_transport === 'browser'
        ? await this.publishThroughBrowser(post, identity, content)
        : await this.driver.publish({
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
      const browser = identity.auth_transport === 'browser'
      const explained = browser
        ? { kind: 'browser', message: error instanceof UserFacingError ? error.message : 'Postline could not send the post through the X browser.' }
        : explainNetworkError('twitter', error)
      const message = explained.message
      if (explained.kind === 'expired')
        await markIdentityExpired(identity)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      let retry = classifyFailure(error)
      if (browser) retry = { kind: error instanceof UserFacingError && error.code === 'x_browser_unavailable' ? 'transient' : 'permanent' }
      return { provider: 'twitter', ok: false, error: message, targetId: Number(target.id), retry, ...account }
    }
  }

  private async publishThroughBrowser(post: { id: number, body: string }, identity: SocialIdentityRow, content?: PublishContent): Promise<{ uri: string, url: string, cid?: string }> {
    if (content?.reply || content?.video)
      throw new UserFacingError('Choose the X API account for replies or videos.')
    const images = (content?.media ?? []).map((image) => {
      if (!image.bytes?.length || !image.mimeType || !/^image\/(jpeg|png|webp|gif)$/.test(image.mimeType))
        throw new UserFacingError('Attach an image file before publishing through the X browser.')
      if (image.altText?.trim())
        throw new UserFacingError('Choose the X API account to publish these images with their alternative text.')
      return { type: image.mimeType, base64: Buffer.from(image.bytes).toString('base64') }
    })
    const result = await twitterBrowserDispatch.dispatch({
      postId: post.id, handle: identity.handle, text: post.body, images,
    })
    if (result.state === 'published')
      return { uri: result.id, url: `https://x.com/${identity.handle}/status/${result.id}` }
    const errors = {
      attention: 'Open X in Channels and check sign-in with the original account before publishing.',
      layout: 'Postline could not verify the X Composer controls. Check sign-in in Channels to run another health check.',
      refused: 'X declined the post in its Composer.',
      uncertain: 'X did not confirm whether the post went out. Retries are paused. Open the original X profile to check the result.',
      unavailable: 'The X browser could not prepare this post. Keep Postline open on this Mac and check the browser in Channels.',
    }
    throw new UserFacingError(errors[result.state], `x_browser_${result.state}`)
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
      listPage: cursor => withTwitterReadBudget(100 * TWITTER_READ_PRICE.post, async () => {
        const value = await this.driver.listAuthoredPosts(credentials, { cursor, limit: 100 })
        return { value, estimatedMicros: value.posts.length * TWITTER_READ_PRICE.post }
      }),
      deletePost: ref => this.driver.deletePost(credentials, ref),
    }
  }

  async syncMetrics() {
    if (!(await networkApps.credentials('twitter')).engagementMetrics) return { synced: 0 }
    return await syncConnectedMetrics<SocialIdentityRow>('twitter', {
      metrics: (identity, uris) => {
        // A post can still be billed if X returns it without public counts.
        const estimate = new Set(uris).size * TWITTER_READ_PRICE.post
        return withTwitterReadBudget(estimate, async () => ({
          value: await this.driver.metrics(identity, uris),
          estimatedMicros: estimate,
        }))
      },
    }, async (identity) => {
      const current = await this.refreshIfExpiring(identity)
      if (!current) return
      return {
        handle: current.handle,
        did: current.external_id || undefined,
        accessToken: current.access_token || undefined,
      }
    })
  }

  /** Paid Inbox work always uses the explicitly selected, authorized account. */
  async withDirectMessages<T>(identityId: number, action: (account: { handle: string, did: string, accessToken: string }, driver: TwitterDriver) => Promise<T>): Promise<T> {
    if (!(await networkApps.credentials('twitter')).directMessages)
      throw new UserFacingError('Enable X API messages in Channels first.')

    const identity = await findIdentityRow<SocialIdentityRow>('twitter', identityId)
    if (!isUsableIdentity(identity) || !identity?.twitter_dm_consent)
      throw new UserFacingError('Reconnect this X account in Channels to allow Inbox messages.')

    const current = await this.refreshIfExpiring(identity)
    if (!current?.twitter_dm_consent || !current.access_token || !current.external_id)
      throw new UserFacingError('Reconnect this X account in Channels to allow Inbox messages.')

    try {
      return await action({ handle: current.handle, did: current.external_id, accessToken: current.access_token }, this.driver)
    }
    catch (error) {
      if (error instanceof TwitterApiError && error.isAuthError) await markIdentityExpired(current)
      throw error
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
          ...(refreshed.scope === undefined ? {} : { twitter_dm_consent: hasDirectMessageScopes(refreshed.scope) }),
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
    input: { accessToken: string, refreshToken?: string, expiresIn?: number, userId: string, username: string, name?: string, directMessages: boolean },
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
      twitter_dm_consent: input.directMessages,
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
