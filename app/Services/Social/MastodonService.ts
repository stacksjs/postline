import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { MastodonApiError, MastodonDriver, normalizeInstance } from './Drivers/MastodonDriver'
import { ensureAccount, now, uuid } from './support'

const database = db as any

type SocialIdentityRow = {
  id: number
  handle: string
  display_name?: string | null
  provider: 'mastodon'
  external_id?: string | null // the instance base URL
  auth_status: 'connected' | 'expired' | 'revoked' | 'missing'
  access_token?: string | null
  account_id?: number | null
  social_driver_id?: number | null
}

type SocialDriverRow = {
  id: number
  provider: 'mastodon'
  display_name: string
  status: 'active' | 'planned' | 'disabled'
  character_limit: number
}

export class MastodonService {
  private driver = new MastodonDriver()

  private config() {
    return {
      instance: String(env.MASTODON_INSTANCE_URL || '').trim(),
      accessToken: String(env.MASTODON_ACCESS_TOKEN || '').trim(),
    }
  }

  async status() {
    const identity = await this.findIdentity()
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'mastodon',
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      instance: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      requiresMedia: false,
      configuredFromEnv: Boolean(cfg.instance && cfg.accessToken),
    }
  }

  /** Connect with an instance URL + personal access token. */
  async connect(input: { instance: string, accessToken: string }) {
    const instance = normalizeInstance(input.instance)
    const accessToken = String(input.accessToken || '').trim()
    if (!accessToken)
      throw new Error('A Mastodon access token is required.')

    const account = await this.driver.verifyCredentials({ instance, accessToken })
    const identity = await this.saveSession({ instance, accessToken, account })
    return this.publicIdentity(identity)
  }

  async connectFromEnv() {
    const cfg = this.config()
    if (!cfg.instance || !cfg.accessToken)
      throw new Error('Set MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN, or connect on the Accounts page.')
    return this.connect(cfg)
  }

  /**
   * Publish an already-created post row to Mastodon. Never throws — failures
   * are recorded on the target and returned so other crosspost providers
   * still succeed.
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
      return { provider: 'mastodon', ok: false, error: messageOf(error) }
    }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'mastodon',
        ok: false,
        error: `Mastodon posts must be ${this.driver.characterLimit} characters or fewer.`,
      }
    }

    const targetUuid = uuid()
    const createdAt = now()
    await database.insertInto('post_targets').values({
      uuid: targetUuid,
      provider: 'mastodon',
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
      const published = await this.driver.publish(
        { instance: identity.external_id || '', accessToken: identity.access_token || '' },
        { text: post.body, media: content?.media, reply: content?.reply },
      )

      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: published.url || published.uri || null,
        remote_cid: published.cid || null,
        failure_reason: null,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return {
        provider: 'mastodon',
        ok: true,
        url: published.url,
        uri: published.uri,
        cid: published.cid,
        targetId: Number(target.id),
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof MastodonApiError && error.isAuthError)
        await this.markExpired(identity.id)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'mastodon', ok: false, error: message, targetId: Number(target.id) }
    }
  }

  private async requireIdentity(): Promise<SocialIdentityRow> {
    const existing = await this.findIdentity()
    if (existing?.access_token && existing.auth_status === 'connected') return existing

    const cfg = this.config()
    if (cfg.instance && cfg.accessToken) {
      await this.connectFromEnv()
      const connected = await this.findIdentity()
      if (connected?.access_token) return connected
    }

    throw new Error('Connect Mastodon before publishing.')
  }

  private async findIdentity(): Promise<SocialIdentityRow | undefined> {
    return await database
      .selectFrom('social_identities')
      .selectAll()
      .where('provider', '=', 'mastodon')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst()
  }

  private async saveSession(input: { instance: string, accessToken: string, account: { accountId: string, username: string, displayName?: string, url: string } }): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()
    const existing = await this.findIdentity()
    const savedAt = now()
    const host = input.instance.replace(/^https?:\/\//, '')
    const handle = `@${input.account.username}@${host}`

    const values = {
      handle,
      display_name: input.account.displayName || input.account.username,
      provider: 'mastodon',
      external_id: input.instance,
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
    await database.updateTable('social_identities')
      .set({ auth_status: 'expired', updated_at: now() })
      .where('id', '=', id)
      .execute()
  }

  private async ensureDriver(): Promise<SocialDriverRow> {
    const existing = await database
      .selectFrom('social_drivers')
      .selectAll()
      .where('provider', '=', 'mastodon')
      .executeTakeFirst()

    if (existing) {
      if (existing.status !== 'active' || existing.character_limit !== this.driver.characterLimit) {
        await database.updateTable('social_drivers').set({
          status: 'active',
          character_limit: this.driver.characterLimit,
          updated_at: now(),
        }).where('id', '=', existing.id).execute()
      }
      return await database.selectFrom('social_drivers').selectAll().where('id', '=', existing.id).executeTakeFirstOrThrow()
    }

    const driverUuid = uuid()
    await database.insertInto('social_drivers').values({
      uuid: driverUuid,
      provider: 'mastodon',
      display_name: 'Mastodon',
      status: 'active',
      character_limit: this.driver.characterLimit,
      capabilities: JSON.stringify({ posts: true, timelines: false, oauth: false, requiresMedia: false }),
      created_at: now(),
      updated_at: now(),
    }).execute()

    return await database.selectFrom('social_drivers').selectAll().where('uuid', '=', driverUuid).executeTakeFirstOrThrow()
  }

  private publicIdentity(row: SocialIdentityRow | undefined) {
    if (!row) {
      return { connected: false, provider: 'mastodon', handle: null, displayName: null, instance: null, authStatus: 'missing' }
    }
    const connected = row.auth_status === 'connected' && Boolean(row.access_token)
    return {
      connected,
      provider: 'mastodon',
      handle: row.handle,
      displayName: row.display_name || null,
      instance: row.external_id || null,
      authStatus: connected ? 'connected' : 'missing',
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const mastodon = new MastodonService()
