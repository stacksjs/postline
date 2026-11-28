import type { NetworkOAuthExchangeOptions } from '../../Support/Social/network-oauth'
import type { NetworkAuthorization } from '../../Support/Social/native-network-consent'
import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, ProviderPurgeAdapter, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { log } from '@stacksjs/logging'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { LinkedInDriver } from './Drivers/LinkedInDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow, saveIdentityTokens } from './identities'
import { resolveLinkedInVersion } from '../../Support/Social/linkedin-text'
import { refreshOnce } from '../../Support/Social/token-refresh'
import { exceedsLimit } from '../../Support/Social/count-text'
import { syncConnectedMetrics } from './sync-connected-metrics'
import { ensureAccount, expiresAt, now, uuid } from './support'
import { explainNetworkError } from '../../Support/Social/network-errors'
import { networkApps } from '../NetworkAppService'
import { UserFacingError } from '../../Support/Http/user-error'
import { classifyFailure } from '../../Support/Social/retry'
import { pendingFirstComment } from '../../Support/Social/post-options'

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
  publicClient: boolean
  redirectUrl: string
  apiVersion: string
  accessToken: string
  authorUrn: string
  scopes: string[]
  organizationPages: boolean
}

/** What signing in asks LinkedIn for: posting as the member, and as their Pages when that is on. */
export function linkedInScopes(organizationPages: boolean, engagementMetrics = false): string[] {
  const member = ['openid', 'profile', 'w_member_social']
  if (engagementMetrics) member.push(organizationPages ? 'r_organization_social_feed' : 'r_member_social_feed')
  // Posting as a Page, and listing the Pages the member administers.
  return organizationPages ? [...member, 'w_organization_social', 'r_organization_admin'] : member
}

export class LinkedInService {
  private driver: LinkedInDriver

  constructor() {
    this.driver = new LinkedInDriver({ apiVersion: resolveLinkedInVersion(env.LINKEDIN_API_VERSION) })
  }

  /**
   * The owner's LinkedIn app (client id, secret, redirect address): from
   * Settings, else the environment. Read each time, so a change in Settings
   * applies without a restart, in every process.
   */
  private async config(): Promise<LinkedInConfig> {
    const app = await networkApps.credentials('linkedin')
    return {
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      publicClient: app.publicClient,
      redirectUrl: app.redirectUrl,
      apiVersion: resolveLinkedInVersion(env.LINKEDIN_API_VERSION),
      accessToken: String(env.LINKEDIN_ACCESS_TOKEN || '').trim(),
      authorUrn: String(env.LINKEDIN_AUTHOR_URN || '').trim(),
      scopes: linkedInScopes(app.organizationPages, app.engagementMetrics),
      organizationPages: app.organizationPages,
    }
  }

  /**
   * The network card's state: top-level fields describe the default account
   * (unchanged for existing callers), `accounts` lists every connected one.
   */
  async status() {
    const rows = await listIdentityRows<SocialIdentityRow>('linkedin')
    const identity = pickDefaultIdentity(rows)
    const cfg = (await this.config())
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
      oauthConfigured: Boolean(cfg.clientId && (cfg.publicClient || cfg.clientSecret) && cfg.redirectUrl),
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

  /** Prepare the LinkedIn consent URL before the action binds it to the browser. */
  async prepareAuthorization(): Promise<NetworkAuthorization> {
    const cfg = (await this.config())
    if (!cfg.clientId || (!cfg.publicClient && !cfg.clientSecret)) {
      throw new UserFacingError('Add your LinkedIn app under Settings, Channels first.')
    }
    if (!cfg.redirectUrl) {
      throw new UserFacingError('Postline could not work out its address for the LinkedIn redirect. Set it under Settings, Channels.')
    }

    const input = {
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state: '',
    }
    return cfg.publicClient ? await this.driver.createNativeAuthorization(input) : { url: this.driver.getAuthUrl(input) }
  }

  /** Handle the OAuth redirect: exchange the code and store the token. */
  async exchangeAuthorizationCode(code: string, { codeVerifier, testOnly }: NetworkOAuthExchangeOptions = {}) {
    const cfg = (await this.config())
    if (!code) throw new Error('LinkedIn did not return an authorization code.')
    if (cfg.publicClient !== Boolean(codeVerifier))
      throw new UserFacingError('Start the LinkedIn connection again from Channels to use the current app settings.')

    const input = {
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      code,
    }
    const token = codeVerifier
      ? await this.driver.exchangeNativeCode({ ...input, codeVerifier })
      : await this.driver.exchangeCode({ ...input, clientSecret: cfg.clientSecret })

    const profile = await this.driver.getProfile(token.accessToken).catch(() => undefined)
    if (testOnly) {
      if (!profile?.sub) throw new UserFacingError('LinkedIn did not return the signed-in member. Check the OpenID Connect product and try again.')
      return
    }
    const authorUrn = profile?.sub ? `urn:li:person:${profile.sub}` : cfg.authorUrn
    if (!authorUrn) throw new Error('Could not resolve your LinkedIn member URN.')

    const session = { accessToken: token.accessToken, refreshToken: token.refreshToken, expiresIn: token.expiresIn }
    const identity = await this.saveSession({ ...session, authorUrn, name: profile?.name })
    if (cfg.organizationPages) await this.connectPages(session)
    return this.publicIdentity(identity)
  }

  /**
   * One account per company Page the member may post for (#130), on the same
   * token: a Page posts as `urn:li:organization:{id}`, and the token's
   * `w_organization_social` is what allows it. A Page the member no longer
   * administers is left as it was; disconnect it from the Accounts page.
   *
   * Listing Pages failing is not the sign-in failing: the member account is
   * already saved, and the reason is logged for the owner.
   */
  async connectPages(session: { accessToken: string, refreshToken?: string, expiresIn?: number }): Promise<number> {
    let pages
    try {
      pages = await this.driver.listOrganizations(session.accessToken)
    }
    catch (error) {
      log.warn(`[postline] LinkedIn Pages were not connected: ${error instanceof Error ? error.message : String(error)}`)
      return 0
    }
    for (const page of pages)
      await this.saveSession({ ...session, authorUrn: page.urn, name: page.name || `Page ${page.id}` })
    return pages.length
  }

  /**
   * Connect using a pre-obtained token from the environment. `revive: false`
   * is the implicit path (a publish falling back to `.env`), which must not
   * bring back an account the user disconnected.
   */
  async connectFromEnv(options: { revive?: boolean } = {}) {
    const cfg = (await this.config())
    if (!cfg.accessToken) {
      throw new Error('Connect LinkedIn in Channels first.')
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

    if (exceedsLimit('linkedin', post.body, this.driver.characterLimit)) {
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
        remote_url: published.url || null,
        ...pendingFirstComment(content?.options, 'linkedin'),
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
      // In words the owner can act on, never the network's raw response. Only
      // a sign-in the network no longer accepts marks the account: a 403 is
      // usually one refused post (a duplicate, a missing permission), and
      // treating it as signed out disconnected accounts that were working.
      const explained = explainNetworkError('linkedin', error)
      const message = explained.message
      if (explained.kind === 'expired')
        await markIdentityExpired(identity)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'linkedin', ok: false, error: message, targetId: Number(target.id), retry: classifyFailure(error), ...account }
    }
  }

  async publishFirstComment(identityId: number, uri: string, message: string): Promise<string | null> {
    const identity = await this.requireIdentity(identityId).catch(() => {
      throw new UserFacingError('Reconnect the LinkedIn account that published this post.')
    })
    try {
      return await this.driver.createComment({
        handle: identity.handle,
        did: identity.external_id || undefined,
        accessToken: identity.access_token || undefined,
      }, uri, message)
    }
    catch (error) {
      if (explainNetworkError('linkedin', error).kind === 'expired') await markIdentityExpired(identity)
      throw error
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

  async syncMetrics(limit = 100) {
    if (!(await networkApps.credentials('linkedin')).engagementMetrics) return { synced: 0 }
    return await syncConnectedMetrics<SocialIdentityRow>('linkedin', this.driver, async (identity) => {
      const current = await this.refreshIfExpiring(identity)
      if (!current) return
      return {
        handle: current.handle,
        did: current.external_id || undefined,
        accessToken: current.access_token || undefined,
      }
    }, limit)
  }

  /**
   * The account to act as. A named account must be usable as-is; without a
   * name this is the default account, falling back to the `.env` token.
   */
  private async requireIdentity(identityId?: number | null): Promise<SocialIdentityRow> {
    if (identityId) {
      const chosen = await findIdentityRow<SocialIdentityRow>('linkedin', identityId)
      const current = isUsableIdentity(chosen) ? await this.refreshIfExpiring(chosen!) : undefined
      if (current) return current
      throw unavailableAccountError('LinkedIn', chosen)
    }

    const existing = await findIdentityRow<SocialIdentityRow>('linkedin')
    if (isUsableIdentity(existing)) {
      const current = await this.refreshIfExpiring(existing!)
      if (current) return current
      throw unavailableAccountError('LinkedIn', await findIdentityRow<SocialIdentityRow>('linkedin', existing!.id))
    }

    // Fall back to an env-configured token if one is available.
    if ((await this.config()).accessToken) {
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
  private async refreshIfExpiring(identity: SocialIdentityRow): Promise<SocialIdentityRow | undefined> {
    const cfg = (await this.config())
    if (!identity.refresh_token || !cfg.clientId || !cfg.clientSecret) return identity

    return await refreshOnce(identity, {
      reload: async () => {
        const row = await findIdentityRow<SocialIdentityRow>('linkedin', identity.id)
        return isUsableIdentity(row) ? row : undefined
      },
      refresh: async (current) => {
        const siblings = (await listIdentityRows<SocialIdentityRow>('linkedin')).filter(sibling =>
          sibling.id !== current.id && isUsableIdentity(sibling) && sibling.refresh_token === current.refresh_token,
        )
        const refreshed = await this.driver.refreshAccessToken({
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
          refreshToken: String(current.refresh_token),
        })
        const nextExpiry = expiresAt(refreshed.expiresIn)
        const nextRefresh = refreshed.refreshToken ?? current.refresh_token
        const tokens = {
          access_token: refreshed.accessToken,
          refresh_token: nextRefresh,
          token_expires_at: nextExpiry,
          auth_status: 'connected',
          updated_at: now(),
        }
        const updated = await saveIdentityTokens(current, tokens)
        if (!updated) return
        // The member and their Pages share one sign-in: renew them together,
        // so a Page is not left holding a token its member has moved past.
        for (const sibling of siblings) await saveIdentityTokens(sibling, tokens)
        return updated
      },
      refused: async current => await markIdentityExpired(current),
    })
  }

  /**
   * Renew every connected account's token that is close to expiry. Run daily
   * by `KeepTokensAlive`, so an account nobody posts from stays connected.
   */
  async keepAlive(): Promise<number> {
    const rows = await listIdentityRows<SocialIdentityRow>('linkedin')
    let renewed = 0
    for (const row of rows.filter(row => isUsableIdentity(row))) {
      const after = await this.refreshIfExpiring(row)
      if (after && after.token_expires_at !== row.token_expires_at) renewed++
    }
    return renewed
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
    const handle = (input.name || input.authorUrn.replace(/^urn:li:(?:person|organization):/, '')).trim()

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
