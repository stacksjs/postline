import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { PendingOAuthStates } from '../../Support/Social/oauth-state'
import { InstagramApiError, InstagramDriver } from './Drivers/InstagramDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow } from './identities'
import { ensureAccount, expiresAt, now, uuid } from './support'

const database = db as any

type SocialIdentityRow = {
  id: number
  handle: string
  display_name?: string | null
  provider: 'instagram'
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
  provider: 'instagram'
  display_name: string
  status: 'active' | 'planned' | 'disabled'
  character_limit: number
}

interface InstagramConfig {
  clientId: string
  clientSecret: string
  redirectUrl: string
  graphVersion: string
  accessToken: string
  userId: string
  username: string
  scopes: string[]
}

export class InstagramService {
  private driver: InstagramDriver
  // OAuth CSRF states between the auth redirect and the callback, keyed by
  // state so two accounts can be connected concurrently.
  private pending = new PendingOAuthStates()

  constructor() {
    this.driver = new InstagramDriver({ graphVersion: this.config().graphVersion })
  }

  private config(): InstagramConfig {
    return {
      clientId: String(env.INSTAGRAM_CLIENT_ID || '').trim(),
      clientSecret: String(env.INSTAGRAM_CLIENT_SECRET || '').trim(),
      redirectUrl: String(env.INSTAGRAM_REDIRECT_URL || '').trim(),
      graphVersion: String(env.INSTAGRAM_GRAPH_VERSION || 'v21.0').trim(),
      accessToken: String(env.INSTAGRAM_ACCESS_TOKEN || '').trim(),
      userId: String(env.INSTAGRAM_USER_ID || '').trim(),
      username: String(env.INSTAGRAM_USERNAME || '').trim(),
      // `instagram_manage_messages` and `pages_messaging` are what the DM inbox
      // runs on. They are requested on every connect rather than behind a flag,
      // because Meta only grants scopes at consent time — a connection made
      // without them cannot gain them later without reconnecting.
      scopes: [
        'instagram_basic',
        'instagram_content_publish',
        'instagram_manage_messages',
        'pages_show_list',
        'pages_read_engagement',
        'pages_messaging',
      ],
    }
  }

  /**
   * The network card's state: top-level fields describe the default account
   * (unchanged for existing callers), `accounts` lists every connected one.
   */
  async status() {
    const rows = await listIdentityRows<SocialIdentityRow>('instagram')
    const identity = pickDefaultIdentity(rows)
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'instagram',
      id: identity ? Number(identity.id) : null,
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      did: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      requiresMedia: true,
      configuredFromEnv: Boolean(cfg.accessToken && cfg.userId),
      oauthConfigured: Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUrl),
      accounts: rows.map(row => toPublicAccount(row, { isDefault: Number(row.id) === Number(identity?.id) })),
    }
  }

  async listAccounts(): Promise<PublicAccount[]> {
    return (await this.status()).accounts
  }

  /** The account a bare `instagram` target publishes through, without connecting anything. */
  async defaultIdentityId(): Promise<number | null> {
    const identity = await findIdentityRow<SocialIdentityRow>('instagram')
    return isUsableIdentity(identity) ? Number(identity!.id) : null
  }

  /** Disconnect one account: tokens dropped, row kept for its posts' history. */
  async disconnect(identityId: number): Promise<PublicAccount> {
    return toPublicAccount(await revokeIdentityRow('instagram', identityId))
  }

  getAuthUrl(): string {
    const cfg = this.config()
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error('Set INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET to connect Instagram.')
    }
    if (!cfg.redirectUrl) {
      throw new Error('Set INSTAGRAM_REDIRECT_URL to connect Instagram.')
    }

    return this.driver.getAuthUrl({
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state: this.pending.issue(true),
    })
  }

  async handleCallback(code: string, state: string) {
    const cfg = this.config()
    if (!code) throw new Error('Facebook did not return an authorization code.')
    // Lenient only when no flow is outstanding at all (a restart mid-consent),
    // which is the leniency the single-slot version had.
    const pending = this.pending.take(state)
    if (!pending.found && !pending.noneOutstanding) {
      throw new Error('Instagram OAuth state mismatch. Please start the connection again.')
    }

    const token = await this.driver.exchangeCode({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUrl: cfg.redirectUrl,
      code,
    })

    // Exchange the short-lived user token for a long-lived (~60-day) one before
    // resolving the Page — a Page token minted from a long-lived user token does
    // not expire on its own, so there's no per-publish refresh grant to run.
    // Best-effort: fall back to the short-lived token if the exchange fails.
    let userToken = token.accessToken
    let expiresIn: number | undefined
    try {
      const longLived = await this.driver.exchangeLongLivedUserToken(cfg.clientId, cfg.clientSecret, token.accessToken)
      userToken = longLived.accessToken
      expiresIn = longLived.expiresIn
    }
    catch {}

    const account = await this.driver.resolveAccount(userToken)
    const identity = await this.saveSession({
      accessToken: account.pageAccessToken,
      igUserId: account.igUserId,
      username: account.username,
      expiresIn,
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
      throw new Error('Set INSTAGRAM_ACCESS_TOKEN (or connect via OAuth) before using Instagram.')
    }

    let igUserId = cfg.userId
    let username = cfg.username || undefined
    let pageAccessToken = cfg.accessToken
    if (!igUserId) {
      const account = await this.driver.resolveAccount(cfg.accessToken)
      igUserId = account.igUserId
      username = account.username
      pageAccessToken = account.pageAccessToken
    }

    const identity = await this.saveSession({ accessToken: pageAccessToken, igUserId, username }, { revive: options.revive ?? true })
    return this.publicIdentity(identity)
  }

  /**
   * Publish an already-created post row to Instagram. Never throws — failures
   * (including the "image required" case) are recorded on the target and
   * returned so other crosspost providers still succeed.
   */
  async publishToPost(
    post: { id: number, body: string },
    content?: PublishContent,
    identityId?: number | null,
  ): Promise<CrosspostTargetResult> {
    const media = content?.media?.[0]
    if (!media?.url) {
      return { provider: 'instagram', ok: false, error: 'Instagram requires an image — add an image URL.' }
    }

    const driver = await this.ensureDriver()

    let identity: SocialIdentityRow
    try {
      identity = await this.requireIdentity(identityId)
    }
    catch (error) {
      return { provider: 'instagram', ok: false, error: messageOf(error), identityId: identityId || undefined }
    }
    const account = { identityId: Number(identity.id), handle: identity.handle }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'instagram',
        ok: false,
        error: `Instagram captions must be ${this.driver.characterLimit} characters or fewer.`,
        ...account,
      }
    }

    const targetUuid = uuid()
    const createdAt = now()
    await database.insertInto('post_targets').values({
      uuid: targetUuid,
      provider: 'instagram',
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
        media: content?.media,
      })

      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: published.uri || null,
        failure_reason: null,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return {
        provider: 'instagram',
        ok: true,
        url: published.url,
        uri: published.uri,
        targetId: Number(target.id),
        ...account,
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof InstagramApiError && error.isAuthError) {
        await markIdentityExpired(identity.id)
      }
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'instagram', ok: false, error: message, targetId: Number(target.id), ...account }
    }
  }

  /**
   * The credentials the DM transport needs. `igUserId` is both the node every
   * messaging call is addressed to and the participant id that marks a message
   * as ours, so it is required rather than optional here.
   */
  async dmIdentity(identityId?: number | null): Promise<{ identityId: number, accessToken: string, igUserId: string, handle: string, graphVersion: string }> {
    const identity = await this.requireIdentity(identityId)
    if (!identity.external_id)
      throw new Error('Reconnect Instagram on the Accounts page — The Open Times needs your Instagram account id to read DMs.')

    return {
      identityId: Number(identity.id),
      accessToken: String(identity.access_token),
      igUserId: String(identity.external_id),
      handle: identity.handle,
      graphVersion: this.config().graphVersion,
    }
  }

  /**
   * The account to act as. A named account must be usable as-is; without a
   * name this is the default account, falling back to the `.env` token.
   */
  private async requireIdentity(identityId?: number | null): Promise<SocialIdentityRow> {
    if (identityId) {
      const chosen = await findIdentityRow<SocialIdentityRow>('instagram', identityId)
      if (isUsableIdentity(chosen)) return chosen!
      throw unavailableAccountError('Instagram', chosen)
    }

    const existing = await findIdentityRow<SocialIdentityRow>('instagram')
    if (isUsableIdentity(existing)) return existing!

    if (this.config().accessToken) {
      const connected = await this.connectFromEnv({ revive: false })
      const identity = connected.id ? await findIdentityRow<SocialIdentityRow>('instagram', connected.id) : undefined
      if (identity?.access_token) return identity
    }

    throw new Error('Connect Instagram before publishing.')
  }

  /**
   * Save tokens against the account they belong to, keyed on the Instagram user
   * id: reconnecting an account refreshes its row, a different one is added.
   */
  private async saveSession(
    input: { accessToken: string, igUserId: string, username?: string, expiresIn?: number },
    options: { revive?: boolean } = {},
  ): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()
    const handle = (input.username || input.igUserId).trim()

    return await upsertIdentityRow<SocialIdentityRow>('instagram', { externalId: input.igUserId, handle }, {
      handle,
      display_name: input.username || null,
      provider: 'instagram',
      external_id: input.igUserId,
      auth_status: 'connected',
      access_token: input.accessToken,
      refresh_token: null,
      token_expires_at: expiresAt(input.expiresIn),
      account_id: accountId,
      social_driver_id: driver.id,
    }, { revive: options.revive, label: 'This Instagram' })
  }

  private async ensureDriver(): Promise<SocialDriverRow> {
    const existing = await database
      .selectFrom('social_drivers')
      .selectAll()
      .where('provider', '=', 'instagram')
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
      provider: 'instagram',
      display_name: 'Instagram',
      status: 'active',
      character_limit: this.driver.characterLimit,
      capabilities: JSON.stringify({ posts: true, timelines: false, oauth: true, requiresMedia: true }),
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
        provider: 'instagram',
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
      provider: 'instagram',
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

export const instagram = new InstagramService()
