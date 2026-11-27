import type { InstagramPageAccount } from '@stacksjs/socials'
import type { NetworkOAuthExchangeOptions } from '../../Support/Social/network-oauth'
import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { InstagramDriver } from './Drivers/InstagramDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow } from './identities'
import { exceedsLimit } from '../../Support/Social/count-text'
import { syncConnectedMetrics } from './sync-connected-metrics'
import { ensureAccount, now, uuid } from './support'
import { explainNetworkError } from '../../Support/Social/network-errors'
import { networkApps } from '../NetworkAppService'
import { UserFacingError } from '../../Support/Http/user-error'
import { classifyFailure } from '../../Support/Social/retry'

const database = db as any
const DEFAULT_GRAPH_VERSION = 'v27.0'

type SocialIdentityRow = {
  id: number
  handle: string
  display_name?: string | null
  provider: 'instagram'
  external_id?: string | null
  auth_status: 'connected' | 'expired' | 'revoked' | 'missing'
  access_token?: string | null
  refresh_token?: string | null
  insights_access_token?: string | null
  instagram_page_id?: string | null
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
  accessToken: string
  insightsAccessToken: string
  engagementMetrics: boolean
  userId: string
  username: string
  scopes: string[]
}

export interface InstagramPageSelection {
  pages: InstagramPageAccount[]
  insightsAccessToken?: string
}

export class InstagramService {
  private driver: InstagramDriver

  constructor() {
    this.driver = new InstagramDriver({ graphVersion: String(env.INSTAGRAM_GRAPH_VERSION ?? '').trim() || DEFAULT_GRAPH_VERSION })
  }

  /**
   * The owner's Instagram app (client id, secret, redirect address): from
   * Settings, else the environment. Read each time, so a change in Settings
   * applies without a restart, in every process.
   */
  private async config(): Promise<InstagramConfig> {
    const app = await networkApps.credentials('instagram')
    return {
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      redirectUrl: app.redirectUrl,
      accessToken: String(env.INSTAGRAM_ACCESS_TOKEN || '').trim(),
      insightsAccessToken: String(env.INSTAGRAM_INSIGHTS_ACCESS_TOKEN || '').trim(),
      engagementMetrics: app.engagementMetrics,
      userId: String(env.INSTAGRAM_USER_ID || '').trim(),
      username: String(env.INSTAGRAM_USERNAME || '').trim(),
      // The messaging permissions are not asked for: the
      // inbox cannot read Instagram without Meta's app review (#129), and a
      // permission nothing uses is one more thing to explain at consent.
      scopes: [
        'instagram_basic',
        'instagram_content_publish',
        'pages_show_list',
        'pages_read_engagement',
        ...(app.engagementMetrics ? ['instagram_manage_insights'] : []),
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
    const cfg = (await this.config())
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

  async prepareAuthorization(): Promise<{ url: string }> {
    const cfg = (await this.config())
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new UserFacingError('Add your Instagram app under Settings, Channels first: its client id and secret.')
    }
    if (!cfg.redirectUrl) {
      throw new UserFacingError('Postline could not work out its address for the Instagram redirect. Set it under Settings, Channels.')
    }

    const url = this.driver.getAuthUrl({
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state: '',
    })
    return { url }
  }

  async exchangeAuthorizationCode(code: string, { testOnly }: NetworkOAuthExchangeOptions = {}): Promise<InstagramPageSelection | undefined> {
    const cfg = (await this.config())
    if (!code) throw new Error('Facebook did not return an authorization code.')

    const token = await this.driver.exchangeCode({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUrl: cfg.redirectUrl,
      code,
    })

    // Obtain the Page token from a long-lived user token. Otherwise the Page
    // connection can expire before the first scheduled post is ready to send.
    let userToken: string
    try {
      const longLived = await this.driver.exchangeLongLivedUserToken(cfg.clientId, cfg.clientSecret, token.accessToken)
      userToken = longLived.accessToken
    }
    catch {
      throw new UserFacingError('Facebook could not authorize a lasting Instagram connection. Check your Meta app settings, then try connecting again.', 'instagram_token_exchange_failed')
    }

    const pages = await this.driver.listAccounts(userToken)
    if (!pages.length) throw new UserFacingError('Facebook did not return a Page linked to an Instagram professional account.')
    if (testOnly) return
    return { pages, insightsAccessToken: cfg.engagementMetrics ? userToken : undefined }
  }

  async connectAuthorizedPage(page: InstagramPageAccount, insightsAccessToken?: string) {
    const identity = await this.saveSession({
      accessToken: page.pageAccessToken,
      insightsAccessToken,
      igUserId: page.igUserId,
      username: page.username,
      pageId: page.pageId,
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
      throw new Error('Connect Instagram in Channels first.')
    }

    let igUserId = cfg.userId
    let username = cfg.username || undefined
    let pageAccessToken = cfg.accessToken
    let insightsAccessToken = cfg.insightsAccessToken
    if (!igUserId) {
      const account = await this.driver.resolveAccount(cfg.accessToken)
      igUserId = account.igUserId
      username = account.username
      pageAccessToken = account.pageAccessToken
      insightsAccessToken ||= cfg.accessToken
    }

    const identity = await this.saveSession({
      accessToken: pageAccessToken,
      insightsAccessToken: cfg.engagementMetrics ? insightsAccessToken : undefined,
      igUserId,
      username,
    }, { revive: options.revive ?? true })
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

    if (exceedsLimit('instagram', post.body, this.driver.characterLimit)) {
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
      // In words the owner can act on, never the network's raw response. Only
      // a sign-in the network no longer accepts marks the account: a 403 is
      // usually one refused post (a duplicate, a missing permission), and
      // treating it as signed out disconnected accounts that were working.
      const explained = explainNetworkError('instagram', error)
      const message = explained.message
      if (explained.kind === 'expired')
        await markIdentityExpired(identity)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'instagram', ok: false, error: message, targetId: Number(target.id), retry: classifyFailure(error), ...account }
    }
  }

  async syncMetrics(limit = 100) {
    if (!(await networkApps.credentials('instagram')).engagementMetrics) return { synced: 0 }
    return await syncConnectedMetrics<SocialIdentityRow>('instagram', this.driver, (identity) => {
      if (!identity.insights_access_token)
        throw new UserFacingError('Reconnect Instagram in Channels to grant access to engagement metrics.')
      return {
        handle: identity.handle,
        did: identity.external_id || undefined,
        accessToken: identity.insights_access_token,
      }
    }, limit)
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

    if ((await this.config()).accessToken) {
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
    input: { accessToken: string, insightsAccessToken?: string, igUserId: string, username?: string, pageId?: string },
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
      ...(input.pageId && { instagram_page_id: input.pageId }),
      auth_status: 'connected',
      access_token: input.accessToken,
      refresh_token: null,
      insights_access_token: input.insightsAccessToken || null,
      token_expires_at: null,
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
