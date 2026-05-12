import type { BlueskySession, PublishedPost, TimelineResult } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { BlueskyApiError, BlueskyDriver } from './Drivers/BlueskyDriver'

const database = db as any

type SocialIdentityRow = {
  id: number
  handle: string
  display_name?: string | null
  provider: 'bluesky'
  external_id?: string | null
  auth_status: 'connected' | 'expired' | 'revoked' | 'missing'
  access_token?: string | null
  refresh_token?: string | null
  account_id?: number | null
  social_driver_id?: number | null
}

type SocialDriverRow = {
  id: number
  provider: 'bluesky'
  display_name: string
  status: 'active' | 'planned' | 'disabled'
  character_limit: number
}

function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function uuid(): string {
  return crypto.randomUUID()
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase()
}

function publicIdentity(row: SocialIdentityRow | undefined) {
  if (!row) {
    return {
      connected: false,
      provider: 'bluesky',
      handle: null,
      displayName: null,
      did: null,
      authStatus: 'missing',
    }
  }

  const connected = row.auth_status === 'connected' && Boolean(row.access_token)

  return {
    connected,
    provider: 'bluesky',
    handle: row.handle,
    displayName: row.display_name || null,
    did: row.external_id || null,
    authStatus: connected ? row.auth_status : 'missing',
  }
}

export class BlueskyService {
  private driver = new BlueskyDriver()

  async status() {
    const identity = await this.findIdentity()
    const driver = await this.ensureDriver()

    return {
      ...publicIdentity(identity),
      characterLimit: driver.character_limit,
      canPublish: Boolean(identity?.access_token) && identity?.auth_status === 'connected',
      configuredFromEnv: Boolean(env.BLUESKY_IDENTIFIER && env.BLUESKY_APP_PASSWORD),
    }
  }

  async connect(identifier: string, password: string) {
    const driver = await this.ensureDriver()
    const session = await this.driver.createSession({
      identifier: normalizeHandle(identifier),
      password,
    })

    const identity = await this.saveSession(session, driver)
    return publicIdentity(identity)
  }

  async connectFromEnv() {
    const identifier = String(env.BLUESKY_IDENTIFIER || '').trim()
    const password = String(env.BLUESKY_APP_PASSWORD || '').trim()
    if (!identifier || !password) {
      throw new Error('Set BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD before using Bluesky.')
    }

    return await this.connect(identifier, password)
  }

  async publishNow(
    text: string,
    external?: { uri: string, title: string, description?: string },
  ): Promise<{ post: PublishedPost, targetId: number, postId: number }> {
    const body = text.trim()
    if (!body) throw new Error('Post text is required.')
    if (body.length > this.driver.characterLimit) {
      throw new Error(`Bluesky posts must be ${this.driver.characterLimit} characters or fewer.`)
    }

    const identity = await this.requireIdentity()
    const driver = await this.ensureDriver()
    const accountId = await this.ensureAccount()
    const postUuid = uuid()
    const targetUuid = uuid()
    const createdAt = now()

    await database.insertInto('posts').values({
      uuid: postUuid,
      title: body.slice(0, 80),
      body,
      status: 'publishing',
      timezone: env.TZ || 'America/Los_Angeles',
      source: 'composer',
      account_id: accountId,
      created_at: createdAt,
      updated_at: createdAt,
    }).execute()

    const post = await database
      .selectFrom('posts')
      .selectAll()
      .where('uuid', '=', postUuid)
      .executeTakeFirstOrThrow()
    const publishInput = { text: body } as Parameters<BlueskyDriver['publish']>[1] & {
      external?: { uri: string, title: string, description?: string }
    }
    if (external) publishInput.external = external

    await database.insertInto('post_targets').values({
      uuid: targetUuid,
      provider: 'bluesky',
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
      const published = await this.withFreshSession(identity, freshIdentity =>
        this.driver.publish({
          handle: freshIdentity.handle,
        did: freshIdentity.external_id || undefined,
        accessToken: freshIdentity.access_token || undefined,
        refreshToken: freshIdentity.refresh_token || undefined,
        }, publishInput),
      )

      const publishedAt = now()
      await database.updateTable('posts').set({
        status: 'published',
        published_at: publishedAt,
        updated_at: publishedAt,
      }).where('id', '=', post.id).execute()

      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: published.uri,
        remote_cid: published.cid || null,
        failure_reason: null,
        updated_at: publishedAt,
      }).where('id', '=', target.id).execute()

      return {
        post: published,
        postId: Number(post.id),
        targetId: Number(target.id),
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = now()
      await database.updateTable('posts').set({
        status: 'failed',
        updated_at: failedAt,
      }).where('id', '=', post.id).execute()

      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: failedAt,
      }).where('id', '=', target.id).execute()

      throw error
    }
  }

  async syncTimeline(limit = 30): Promise<TimelineResult & { saved: number }> {
    const identity = await this.requireIdentity()
    const driver = await this.ensureDriver()
    const timeline = await this.withFreshSession(identity, freshIdentity =>
      this.driver.timeline({
        handle: freshIdentity.handle,
        did: freshIdentity.external_id || undefined,
        accessToken: freshIdentity.access_token || undefined,
        refreshToken: freshIdentity.refresh_token || undefined,
      }, { limit }),
    )

    let saved = 0
    for (const item of timeline.items) {
      const existing = await database
        .selectFrom('timeline_items')
        .select(['id'])
        .where('remote_uri', '=', item.uri)
        .executeTakeFirst()

      const values = {
        provider: 'bluesky',
        remote_uri: item.uri,
        author_handle: item.authorHandle,
        author_name: item.authorName || null,
        body: item.body,
        posted_at: item.postedAt.slice(0, 19).replace('T', ' '),
        like_count: item.likeCount,
        repost_count: item.repostCount,
        reply_count: item.replyCount,
        social_driver_id: driver.id,
        social_identity_id: identity.id,
        updated_at: now(),
      }

      if (existing) {
        await database.updateTable('timeline_items').set(values).where('id', '=', existing.id).execute()
      }
      else {
        await database.insertInto('timeline_items').values({
          uuid: uuid(),
          ...values,
          created_at: now(),
        }).execute()
      }
      saved++
    }

    return { ...timeline, saved }
  }

  private async withFreshSession<T>(
    identity: SocialIdentityRow,
    callback: (identity: SocialIdentityRow) => Promise<T>,
  ): Promise<T> {
    try {
      return await callback(identity)
    }
    catch (error) {
      if (!(error instanceof BlueskyApiError) || !error.isAuthError || !identity.refresh_token) {
        throw error
      }

      const session = await this.driver.refreshSession(identity.refresh_token)
      const driver = await this.ensureDriver()
      const refreshed = await this.saveSession(session, driver)
      return await callback(refreshed)
    }
  }

  private async requireIdentity(): Promise<SocialIdentityRow> {
    const existing = await this.findIdentity()
    if (existing?.access_token) return existing

    await this.connectFromEnv()
    const connected = await this.findIdentity()
    if (connected?.access_token) return connected

    throw new Error('Connect Bluesky before publishing.')
  }

  private async findIdentity(): Promise<SocialIdentityRow | undefined> {
    return await database
      .selectFrom('social_identities')
      .selectAll()
      .where('provider', '=', 'bluesky')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst()
  }

  private async saveSession(session: BlueskySession, driver: SocialDriverRow): Promise<SocialIdentityRow> {
    const accountId = await this.ensureAccount()
    const existing = await this.findIdentity()
    const savedAt = now()
    const values = {
      handle: normalizeHandle(session.handle),
      display_name: session.displayName || null,
      provider: 'bluesky',
      external_id: session.did,
      auth_status: 'connected',
      access_token: session.accessJwt,
      refresh_token: session.refreshJwt,
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

  private async ensureDriver(): Promise<SocialDriverRow> {
    const existing = await database
      .selectFrom('social_drivers')
      .selectAll()
      .where('provider', '=', 'bluesky')
      .executeTakeFirst()

    if (existing) {
      if (existing.status !== 'active') {
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
      provider: 'bluesky',
      display_name: 'Bluesky',
      status: 'active',
      character_limit: this.driver.characterLimit,
      capabilities: JSON.stringify({ posts: true, timelines: true, appPassword: true }),
      created_at: now(),
      updated_at: now(),
    }).execute()

    return await database
      .selectFrom('social_drivers')
      .selectAll()
      .where('uuid', '=', driverUuid)
      .executeTakeFirstOrThrow()
  }

  private async ensureAccount(): Promise<number> {
    const existing = await database
      .selectFrom('accounts')
      .select(['id'])
      .orderBy('id', 'asc')
      .executeTakeFirst()

    if (existing?.id) return Number(existing.id)

    const accountUuid = uuid()
    await database.insertInto('accounts').values({
      uuid: accountUuid,
      name: 'Chris Breuer',
      workspace_name: 'Postline',
      timezone: 'America/Los_Angeles',
      default_audience: 'public',
      created_at: now(),
      updated_at: now(),
    }).execute()

    const account = await database
      .selectFrom('accounts')
      .select(['id'])
      .where('uuid', '=', accountUuid)
      .executeTakeFirstOrThrow()

    return Number(account.id)
  }
}

export const bluesky = new BlueskyService()
