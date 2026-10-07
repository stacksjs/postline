import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, ProviderPurgeAdapter, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { PendingOAuthStates } from '../../Support/Social/oauth-state'
import { LinkedInApiError, LinkedInDriver } from './Drivers/LinkedInDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow } from './identities'
import { ensureAccount, expiresAt, isExpiringSoon, now, uuid } from './support'

const database = db as any

type SocialIdentityRow = {
  id: number
  handle: string
  display_name?: string | null
  provider: 'linkedin'
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
  provider: 'linkedin'
  display_name: string
  status: 'active' | 'planned' | 'disabled'
  character_limit: number
}

interface LinkedInConfig {
  clientId: string
  clientSecret: string
  redirectUrl: string
  apiVersion: string
  accessToken: string
  authorUrn: string
  scopes: string[]
}

export class LinkedInService {
  private driver: LinkedInDriver
  // OAuth CSRF states between the auth redirect and the callback, keyed by
  // state so two accounts can be connected concurrently.
  private pending = new PendingOAuthStates()

  constructor() {
    this.driver = new LinkedInDriver({ apiVersion: this.config().apiVersion })
  }

  private config(): LinkedInConfig {
    return {
      clientId: String(env.LINKEDIN_CLIENT_ID || '').trim(),
      clientSecret: String(env.LINKEDIN_CLIENT_SECRET || '').trim(),
      redirectUrl: String(env.LINKEDIN_REDIRECT_URL || '').trim(),
      apiVersion: String(env.LINKEDIN_API_VERSION || '202405').trim(),
      accessToken: String(env.LINKEDIN_ACCESS_TOKEN || '').trim(),
      authorUrn: String(env.LINKEDIN_AUTHOR_URN || '').trim(),
      scopes: ['openid', 'profile', 'w_member_social'],
    }
  }

  /**
   * The network card's state: top-level fields describe the default account
   * (unchanged for existing callers), `accounts` lists every connected one.
   */
  async status() {
    const rows = await listIdentityRows<SocialIdentityRow>('linkedin')
    const identity = pickDefaultIdentity(rows)
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'linkedin',
      id: identity ? Number(identity.id) : null,
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      did: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      configuredFromEnv: Boolean(cfg.accessToken),
      oauthConfigured: Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUrl),
      accounts: rows.map(row => toPublicAccount(row, { isDefault: Number(row.id) === Number(identity?.id) })),
    }
  }

  async listAccounts(): Promise<PublicAccount[]> {
    return (await this.status()).accounts
  }

  /** The account a bare `linkedin` target publishes through, without connecting anything. */
  async defaultIdentityId(): Promise<number | null> {
    const identity = await findIdentityRow<SocialIdentityRow>('linkedin')
    return isUsableIdentity(identity) ? Number(identity!.id) : null
  }

  /** Disconnect one account: tokens dropped, row kept for its posts' history. */
  async disconnect(identityId: number): Promise<PublicAccount> {
    return toPublicAccount(await revokeIdentityRow('linkedin', identityId))
  }

  /** Build the LinkedIn consent URL and remember the CSRF state. */
  getAuthUrl(): string {
    const cfg = this.config()
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error('Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to connect with LinkedIn.')
    }
    if (!cfg.redirectUrl) {
      throw new Error('Set LINKEDIN_REDIRECT_URL to connect with LinkedIn.')
    }

    return this.driver.getAuthUrl({
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state: this.pending.issue(true),
    })
  }

  /** Handle the OAuth redirect: exchange the code and store the token. */
  async handleCallback(code: string, state: string) {
    const cfg = this.config()
    if (!code) throw new Error('LinkedIn did not return an authorization code.')
    // Lenient only when no flow is outstanding at all (a restart mid-consent),
    // which is the leniency the single-slot version had.
    const pending = this.pending.take(state)
    if (!pending.found && !pending.noneOutstanding) {
      throw new Error('LinkedIn OAuth state mismatch. Please start the connection again.')
    }

    const token = await this.driver.exchangeCode({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUrl: cfg.redirectUrl,
      code,
    })

    const profile = await this.driver.getProfile(token.accessToken).catch(() => undefined)
    const authorUrn = profile?.sub ? `urn:li:person:${profile.sub}` : cfg.authorUrn
    if (!authorUrn) throw new Error('Could not resolve your LinkedIn member URN.')

    const identity = await this.saveSession({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      authorUrn,
      name: profile?.name,
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
      throw new Error('Set LINKEDIN_ACCESS_TOKEN (or connect via OAuth) before using LinkedIn.')
    }

    let authorUrn = cfg.authorUrn
    let name: string | undefined
    if (!authorUrn) {
      const profile = await this.driver.getProfile(cfg.accessToken)
      authorUrn = `urn:li:person:${profile.sub}`
      name = profile.name
    }

    const identity = await this.saveSession({ accessToken: cfg.accessToken, authorUrn, name }, { revive: options.revive ?? true })
    return this.publicIdentity(identity)
  }

  /**
   * Publish an already-created post row to LinkedIn as a new target. Never
   * throws — failures are recorded on the target and returned so a crosspost
   * to other providers can still succeed.
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
      return { provider: 'linkedin', ok: false, error: messageOf(error), identityId: identityId || undefined }
    }
    const account = { identityId: Number(identity.id), handle: identity.handle }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'linkedin',
        ok: false,
        error: `LinkedIn posts must be ${this.driver.characterLimit} characters or fewer.`,
        ...account,
      }
    }

    const targetUuid = uuid()
    const createdAt = now()
    await database.insertInto('post_targets').values({
      uuid: targetUuid,
      provider: 'linkedin',
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
        ...(content?.external ? { external: content.external } : {}),
        ...(content?.media?.length ? { media: content.media } : {}),
      })

      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: published.uri || null,
        failure_reason: null,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return {
        provider: 'linkedin',
        ok: true,
        url: published.url,
        uri: published.uri,
        targetId: Number(target.id),
        ...account,
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof LinkedInApiError && error.isAuthError) {
        await markIdentityExpired(identity.id)
      }
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'linkedin', ok: false, error: message, targetId: Number(target.id), ...account }
    }
  }

  /**
   * The purge surface for LinkedIn. Deleting keys on the post URN stored in
   * `remote_uri`. Enumerating the account's full history additionally needs
   * `r_member_social`, which publishing-only apps don't hold — the driver
   * turns that rejection into an actionable message.
   *
   * Pass an identity id to purge one specific account; without one this is the
   * default account, as before.
   */
  async purgeAdapter(identityId?: number | null): Promise<ProviderPurgeAdapter> {
    const identity = await this.requireIdentity(identityId)
    const credentials = {
      handle: identity.handle,
      // `external_id` carries the member URN (urn:li:person:{sub}).
      did: identity.external_id || undefined,
      accessToken: identity.access_token || undefined,
    }

    return {
      provider: 'linkedin',
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
      const chosen = await findIdentityRow<SocialIdentityRow>('linkedin', identityId)
      if (isUsableIdentity(chosen)) return await this.refreshIfExpiring(chosen!)
      throw unavailableAccountError('LinkedIn', chosen)
    }

    const existing = await findIdentityRow<SocialIdentityRow>('linkedin')
    if (isUsableIdentity(existing)) return await this.refreshIfExpiring(existing!)

    // Fall back to an env-configured token if one is available.
    if (this.config().accessToken) {
      const connected = await this.connectFromEnv({ revive: false })
      const identity = connected.id ? await findIdentityRow<SocialIdentityRow>('linkedin', connected.id) : undefined
      if (identity?.access_token) return identity
    }

    throw new Error('Connect LinkedIn before publishing.')
  }

  /**
   * Refresh the access token when it's within its pre-expiry window and a
   * refresh token is on file (LinkedIn only issues one when the app is enrolled
   * in the refresh-token program). Best-effort: any failure leaves the current
   * token in place so a real auth failure still surfaces at publish time.
   */
  private async refreshIfExpiring(identity: SocialIdentityRow): Promise<SocialIdentityRow> {
    const cfg = this.config()
    if (!identity.refresh_token || !isExpiringSoon(identity.token_expires_at)) return identity
    if (!cfg.clientId || !cfg.clientSecret) return identity

    try {
      const refreshed = await this.driver.refreshAccessToken({
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        refreshToken: identity.refresh_token,
      })
      const nextExpiry = expiresAt(refreshed.expiresIn)
      // LinkedIn rotates the refresh token on some grants — keep the new one.
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
   * Save tokens against the account they belong to, keyed on the member URN.
   * The handle here is a display name, so it is never used to match — two
   * people called the same thing are still two accounts.
   */
  private async saveSession(
    input: { accessToken: string, authorUrn: string, name?: string, refreshToken?: string, expiresIn?: number },
    options: { revive?: boolean } = {},
  ): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()
    const handle = (input.name || input.authorUrn.replace('urn:li:person:', '')).trim()

    return await upsertIdentityRow<SocialIdentityRow>('linkedin', { externalId: input.authorUrn }, {
      handle,
      display_name: input.name || null,
      provider: 'linkedin',
      external_id: input.authorUrn,
      auth_status: 'connected',
      access_token: input.accessToken,
      refresh_token: input.refreshToken ?? null,
      token_expires_at: expiresAt(input.expiresIn),
      account_id: accountId,
      social_driver_id: driver.id,
    }, { revive: options.revive, label: 'This LinkedIn' })
  }

  private async ensureDriver(): Promise<SocialDriverRow> {
    const existing = await database
      .selectFrom('social_drivers')
      .selectAll()
      .where('provider', '=', 'linkedin')
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
      provider: 'linkedin',
      display_name: 'LinkedIn',
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
        provider: 'linkedin',
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
      provider: 'linkedin',
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

export const linkedin = new LinkedInService()
