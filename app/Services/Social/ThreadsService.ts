import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { PendingOAuthStates } from '../../Support/Social/oauth-state'
import { ThreadsApiError, ThreadsDriver } from './Drivers/ThreadsDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow } from './identities'
import { ensureAccount, expiresAt, isExpiringSoon, now, uuid } from './support'

const database = db as any

type SocialIdentityRow = {
  id: number
  handle: string
  display_name?: string | null
  provider: 'threads'
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
  provider: 'threads'
  display_name: string
  status: 'active' | 'planned' | 'disabled'
  character_limit: number
}

interface ThreadsConfig {
  clientId: string
  clientSecret: string
  redirectUrl: string
  graphVersion: string
  accessToken: string
  userId: string
  username: string
  scopes: string[]
}

export class ThreadsService {
  private driver: ThreadsDriver
  // OAuth CSRF states between the auth redirect and the callback, keyed by
  // state so two accounts can be connected concurrently.
  private pending = new PendingOAuthStates()

  constructor() {
    this.driver = new ThreadsDriver({ graphVersion: this.config().graphVersion })
  }

  private config(): ThreadsConfig {
    return {
      clientId: String(env.THREADS_CLIENT_ID || '').trim(),
      clientSecret: String(env.THREADS_CLIENT_SECRET || '').trim(),
      redirectUrl: String(env.THREADS_REDIRECT_URL || '').trim(),
      graphVersion: String(env.THREADS_GRAPH_VERSION || 'v1.0').trim(),
      accessToken: String(env.THREADS_ACCESS_TOKEN || '').trim(),
      userId: String(env.THREADS_USER_ID || '').trim(),
      username: String(env.THREADS_USERNAME || '').trim(),
      scopes: ['threads_basic', 'threads_content_publish'],
    }
  }

  /**
   * The network card's state: top-level fields describe the default account
   * (unchanged for existing callers), `accounts` lists every connected one.
   */
  async status() {
    const rows = await listIdentityRows<SocialIdentityRow>('threads')
    const identity = pickDefaultIdentity(rows)
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'threads',
      id: identity ? Number(identity.id) : null,
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      did: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      requiresMedia: false,
      configuredFromEnv: Boolean(cfg.accessToken && cfg.userId),
      oauthConfigured: Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUrl),
      accounts: rows.map(row => toPublicAccount(row, { isDefault: Number(row.id) === Number(identity?.id) })),
    }
  }

  async listAccounts(): Promise<PublicAccount[]> {
    return (await this.status()).accounts
  }

  /** The account a bare `threads` target publishes through, without connecting anything. */
  async defaultIdentityId(): Promise<number | null> {
    const identity = await findIdentityRow<SocialIdentityRow>('threads')
    return isUsableIdentity(identity) ? Number(identity!.id) : null
  }

  /** Disconnect one account: tokens dropped, row kept for its posts' history. */
  async disconnect(identityId: number): Promise<PublicAccount> {
    return toPublicAccount(await revokeIdentityRow('threads', identityId))
  }

  getAuthUrl(): string {
    const cfg = this.config()
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error('Set THREADS_CLIENT_ID and THREADS_CLIENT_SECRET to connect Threads.')
    }
    if (!cfg.redirectUrl) {
      throw new Error('Set THREADS_REDIRECT_URL to connect Threads.')
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
    if (!code) throw new Error('Threads did not return an authorization code.')
    // Lenient only when no flow is outstanding at all (a restart mid-consent),
    // which is the leniency the single-slot version had.
    const pending = this.pending.take(state)
    if (!pending.found && !pending.noneOutstanding) {
      throw new Error('Threads OAuth state mismatch. Please start the connection again.')
    }

    const token = await this.driver.exchangeCode({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUrl: cfg.redirectUrl,
      code,
    })

    // Upgrade the short-lived (~1h) token to a long-lived (~60-day) one so
    // scheduled posts keep working, then resolve the account against it. If the
    // exchange fails, fall back to the short-lived token — publishing still
    // works, just briefly.
    let accessToken = token.accessToken
    let expiresIn = token.expiresIn
    try {
      const longLived = await this.driver.exchangeLongLivedToken(cfg.clientSecret, token.accessToken)
      accessToken = longLived.accessToken
      expiresIn = longLived.expiresIn
    }
    catch {}

    const account = await this.driver.resolveAccount(accessToken)
    const identity = await this.saveSession({
      accessToken: account.accessToken,
      threadsUserId: account.threadsUserId,
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
      throw new Error('Set THREADS_ACCESS_TOKEN (or connect via OAuth) before using Threads.')
    }

    let threadsUserId = cfg.userId
    let username = cfg.username || undefined
    let accessToken = cfg.accessToken
    if (!threadsUserId) {
      const account = await this.driver.resolveAccount(cfg.accessToken)
      threadsUserId = account.threadsUserId
      username = account.username
      accessToken = account.accessToken
    }

    const identity = await this.saveSession({ accessToken, threadsUserId, username }, { revive: options.revive ?? true })
    return this.publicIdentity(identity)
  }

  /**
   * Publish an already-created post row to Threads. Never throws — failures are
   * recorded on the target and returned so other crosspost providers still
   * succeed. Threads is text-first; an image is optional.
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
      return { provider: 'threads', ok: false, error: messageOf(error), identityId: identityId || undefined }
    }
    const account = { identityId: Number(identity.id), handle: identity.handle }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'threads',
        ok: false,
        error: `Threads posts must be ${this.driver.characterLimit} characters or fewer.`,
        ...account,
      }
    }

    const targetUuid = uuid()
    const createdAt = now()
    await database.insertInto('post_targets').values({
      uuid: targetUuid,
      provider: 'threads',
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
        provider: 'threads',
        ok: true,
        url: published.url,
        uri: published.uri,
        targetId: Number(target.id),
        ...account,
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof ThreadsApiError && error.isAuthError) {
        await markIdentityExpired(identity.id)
      }
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'threads', ok: false, error: message, targetId: Number(target.id), ...account }
    }
  }

  /**
   * The account to act as. A named account must be usable as-is; without a
   * name this is the default account, falling back to the `.env` token.
   */
  private async requireIdentity(identityId?: number | null): Promise<SocialIdentityRow> {
    if (identityId) {
      const chosen = await findIdentityRow<SocialIdentityRow>('threads', identityId)
      if (isUsableIdentity(chosen)) return await this.refreshIfExpiring(chosen!)
      throw unavailableAccountError('Threads', chosen)
    }

    const existing = await findIdentityRow<SocialIdentityRow>('threads')
    if (isUsableIdentity(existing)) return await this.refreshIfExpiring(existing!)

    if (this.config().accessToken) {
      const connected = await this.connectFromEnv({ revive: false })
      const identity = connected.id ? await findIdentityRow<SocialIdentityRow>('threads', connected.id) : undefined
      if (identity?.access_token) return identity
    }

    throw new Error('Connect Threads before publishing.')
  }

  /**
   * Refresh a long-lived token that's within its pre-expiry window, extending
   * it another ~60 days. Best-effort: a refresh failure leaves the current
   * token in place, so a genuinely dead token still surfaces at publish time
   * (marking the identity expired and prompting a reconnect) rather than here.
   */
  private async refreshIfExpiring(identity: SocialIdentityRow): Promise<SocialIdentityRow> {
    if (!identity.access_token || !isExpiringSoon(identity.token_expires_at)) return identity

    try {
      const refreshed = await this.driver.refreshLongLivedToken(identity.access_token)
      const nextExpiry = expiresAt(refreshed.expiresIn)
      await database.updateTable('social_identities').set({
        access_token: refreshed.accessToken,
        token_expires_at: nextExpiry,
        auth_status: 'connected',
        updated_at: now(),
      }).where('id', '=', identity.id).execute()

      return { ...identity, access_token: refreshed.accessToken, token_expires_at: nextExpiry }
    }
    catch {
      return identity
    }
  }

  /**
   * Save tokens against the account they belong to, keyed on the Threads user
   * id: reconnecting an account refreshes its row, a different one is added.
   */
  private async saveSession(
    input: { accessToken: string, threadsUserId: string, username?: string, expiresIn?: number },
    options: { revive?: boolean } = {},
  ): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()
    const handle = (input.username || input.threadsUserId).trim()

    return await upsertIdentityRow<SocialIdentityRow>('threads', { externalId: input.threadsUserId, handle }, {
      handle,
      display_name: input.username || null,
      provider: 'threads',
      external_id: input.threadsUserId,
      auth_status: 'connected',
      access_token: input.accessToken,
      refresh_token: null,
      token_expires_at: expiresAt(input.expiresIn),
      account_id: accountId,
      social_driver_id: driver.id,
    }, { revive: options.revive, label: 'This Threads' })
  }

  private async ensureDriver(): Promise<SocialDriverRow> {
    const existing = await database
      .selectFrom('social_drivers')
      .selectAll()
      .where('provider', '=', 'threads')
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
      provider: 'threads',
      display_name: 'Threads',
      status: 'active',
      character_limit: this.driver.characterLimit,
      capabilities: JSON.stringify({ posts: true, timelines: false, oauth: true, requiresMedia: false }),
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
        provider: 'threads',
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
      provider: 'threads',
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

export const threads = new ThreadsService()
