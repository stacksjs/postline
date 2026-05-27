import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { LinkedInApiError, LinkedInDriver } from './Drivers/LinkedInDriver'
import { ensureAccount, now, uuid } from './support'

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

function randomState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export class LinkedInService {
  private driver: LinkedInDriver
  // OAuth CSRF token stashed between the auth redirect and the callback.
  // Postline runs single-user, so module memory is an adequate store.
  private pendingState: string | null = null

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

  async status() {
    const identity = await this.findIdentity()
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'linkedin',
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      did: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      configuredFromEnv: Boolean(cfg.accessToken),
      oauthConfigured: Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUrl),
    }
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

    this.pendingState = randomState()
    return this.driver.getAuthUrl({
      clientId: cfg.clientId,
      redirectUrl: cfg.redirectUrl,
      scopes: cfg.scopes,
      state: this.pendingState,
    })
  }

  /** Handle the OAuth redirect: exchange the code and store the token. */
  async handleCallback(code: string, state: string) {
    const cfg = this.config()
    if (!code) throw new Error('LinkedIn did not return an authorization code.')
    if (this.pendingState && state !== this.pendingState) {
      throw new Error('LinkedIn OAuth state mismatch. Please start the connection again.')
    }
    this.pendingState = null

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
      authorUrn,
      name: profile?.name,
    })
    return this.publicIdentity(identity)
  }

  /** Connect using a pre-obtained token from the environment. */
  async connectFromEnv() {
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

    const identity = await this.saveSession({ accessToken: cfg.accessToken, authorUrn, name })
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
  ): Promise<CrosspostTargetResult> {
    const driver = await this.ensureDriver()

    let identity: SocialIdentityRow
    try {
      identity = await this.requireIdentity()
    }
    catch (error) {
      return { provider: 'linkedin', ok: false, error: messageOf(error) }
    }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'linkedin',
        ok: false,
        error: `LinkedIn posts must be ${this.driver.characterLimit} characters or fewer.`,
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
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof LinkedInApiError && error.isAuthError) {
        await this.markExpired(identity.id)
      }
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'linkedin', ok: false, error: message, targetId: Number(target.id) }
    }
  }

  private async requireIdentity(): Promise<SocialIdentityRow> {
    const existing = await this.findIdentity()
    if (existing?.access_token && existing.auth_status === 'connected') return existing

    // Fall back to an env-configured token if one is available.
    if (this.config().accessToken) {
      await this.connectFromEnv()
      const connected = await this.findIdentity()
      if (connected?.access_token) return connected
    }

    throw new Error('Connect LinkedIn before publishing.')
  }

  private async findIdentity(): Promise<SocialIdentityRow | undefined> {
    return await database
      .selectFrom('social_identities')
      .selectAll()
      .where('provider', '=', 'linkedin')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst()
  }

  private async saveSession(input: { accessToken: string, authorUrn: string, name?: string }): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()
    const existing = await this.findIdentity()
    const savedAt = now()
    const handle = (input.name || input.authorUrn.replace('urn:li:person:', '')).trim()

    const values = {
      handle,
      display_name: input.name || null,
      provider: 'linkedin',
      external_id: input.authorUrn,
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
