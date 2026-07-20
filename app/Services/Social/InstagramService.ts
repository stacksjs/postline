import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { InstagramApiError, InstagramDriver } from './Drivers/InstagramDriver'
import { ensureAccount, now, uuid } from './support'

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

function randomState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export class InstagramService {
  private driver: InstagramDriver
  private pendingState: string | null = null

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
      scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'],
    }
  }

  async status() {
    const identity = await this.findIdentity()
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'instagram',
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      did: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      requiresMedia: true,
      configuredFromEnv: Boolean(cfg.accessToken && cfg.userId),
      oauthConfigured: Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUrl),
    }
  }

  getAuthUrl(): string {
    const cfg = this.config()
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error('Set INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET to connect Instagram.')
    }
    if (!cfg.redirectUrl) {
      throw new Error('Set INSTAGRAM_REDIRECT_URL to connect Instagram.')
    }

    this.pendingState = randomState()
    return this.driver.getAuthUrl({
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state: this.pendingState,
    })
  }

  async handleCallback(code: string, state: string) {
    const cfg = this.config()
    if (!code) throw new Error('Facebook did not return an authorization code.')
    if (this.pendingState && state !== this.pendingState) {
      throw new Error('Instagram OAuth state mismatch. Please start the connection again.')
    }
    this.pendingState = null

    const token = await this.driver.exchangeCode({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUrl: cfg.redirectUrl,
      code,
    })

    const account = await this.driver.resolveAccount(token.accessToken)
    const identity = await this.saveSession({
      accessToken: account.pageAccessToken,
      igUserId: account.igUserId,
      username: account.username,
    })
    return this.publicIdentity(identity)
  }

  async connectFromEnv() {
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

    const identity = await this.saveSession({ accessToken: pageAccessToken, igUserId, username })
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
  ): Promise<CrosspostTargetResult> {
    const media = content?.media?.[0]
    if (!media?.url) {
      return { provider: 'instagram', ok: false, error: 'Instagram requires an image — add an image URL.' }
    }

    const driver = await this.ensureDriver()

    let identity: SocialIdentityRow
    try {
      identity = await this.requireIdentity()
    }
    catch (error) {
      return { provider: 'instagram', ok: false, error: messageOf(error) }
    }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'instagram',
        ok: false,
        error: `Instagram captions must be ${this.driver.characterLimit} characters or fewer.`,
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
        // Instagram only accepts URL media (it has no blob upload); drop
        // any bytes-only entries from the shared PublishContent.
        media: content?.media
          ?.filter((item): item is { url: string, altText?: string } => Boolean(item.url))
          .map(item => ({ url: item.url, altText: item.altText })),
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
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof InstagramApiError && error.isAuthError) {
        await this.markExpired(identity.id)
      }
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'instagram', ok: false, error: message, targetId: Number(target.id) }
    }
  }

  private async requireIdentity(): Promise<SocialIdentityRow> {
    const existing = await this.findIdentity()
    if (existing?.access_token && existing.auth_status === 'connected') return existing

    if (this.config().accessToken) {
      await this.connectFromEnv()
      const connected = await this.findIdentity()
      if (connected?.access_token) return connected
    }

    throw new Error('Connect Instagram before publishing.')
  }

  private async findIdentity(): Promise<SocialIdentityRow | undefined> {
    return await database
      .selectFrom('social_identities')
      .selectAll()
      .where('provider', '=', 'instagram')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst()
  }

  private async saveSession(input: { accessToken: string, igUserId: string, username?: string }): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()
    const existing = await this.findIdentity()
    const savedAt = now()
    const handle = (input.username || input.igUserId).trim()

    const values = {
      handle,
      display_name: input.username || null,
      provider: 'instagram',
      external_id: input.igUserId,
      auth_status: 'connected',
      access_token: input.accessToken,
      refresh_token: null,
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
