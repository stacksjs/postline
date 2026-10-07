import type { BlueskySession, CrosspostTargetResult, ProviderPurgeAdapter, PublishContent, PublishedPost, SocialIdentityCredentials, TimelineResult } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import type { PublicAccount } from '../../Support/Social/accounts'
import { pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { describeBlueskyError } from '../../Support/Social/bluesky-errors'
import { BlueskyApiError, BlueskyDriver } from './Drivers/BlueskyDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow } from './identities'

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
    provider: 'bluesky',
    id: Number(row.id),
    handle: row.handle,
    displayName: row.display_name || null,
    did: row.external_id || null,
    authStatus: connected ? row.auth_status : 'missing',
  }
}

/**
 * An account Bluesky can publish with. Looser than the other networks: an
 * expired access JWT is fine as long as a token is on file, because
 * `withFreshSession` refreshes it mid-request.
 */
function hasSession(row: SocialIdentityRow): boolean {
  return row.auth_status !== 'revoked' && Boolean(row.access_token)
}

export class BlueskyService {
  private driver = new BlueskyDriver()

  /**
   * The network card's state. The top-level fields describe the default
   * account, exactly as they did when Bluesky held one account, so existing
   * callers keep working; `accounts` lists every connected one.
   */
  async status() {
    const rows = await listIdentityRows<SocialIdentityRow>('bluesky')
    const identity = pickDefaultIdentity(rows)
    const driver = await this.ensureDriver()

    return {
      ...publicIdentity(identity),
      characterLimit: driver.character_limit,
      canPublish: Boolean(identity?.access_token) && identity?.auth_status === 'connected',
      configuredFromEnv: Boolean(env.BLUESKY_IDENTIFIER && env.BLUESKY_APP_PASSWORD),
      accounts: this.toAccounts(rows, identity),
    }
  }

  /** Every connected (not disconnected) Bluesky account, default first-class. */
  async listAccounts(): Promise<PublicAccount[]> {
    const rows = await listIdentityRows<SocialIdentityRow>('bluesky')
    return this.toAccounts(rows, pickDefaultIdentity(rows))
  }

  /** The account a bare `bluesky` target publishes through, without connecting anything. */
  async defaultIdentityId(): Promise<number | null> {
    const identity = await findIdentityRow<SocialIdentityRow>('bluesky')
    return identity && hasSession(identity) ? Number(identity.id) : null
  }

  /**
   * Log in and save the account. A handle that is already connected has its
   * session refreshed; any other handle is added alongside the existing ones.
   */
  async connect(identifier: string, password: string, options: { revive?: boolean } = {}) {
    const driver = await this.ensureDriver()
    const session = await this.driver.createSession({
      identifier: normalizeHandle(identifier),
      password,
    })

    const identity = await this.saveSession(session, driver, { revive: options.revive ?? true })
    return publicIdentity(identity)
  }

  async connectFromEnv(options: { revive?: boolean } = {}) {
    const identifier = String(env.BLUESKY_IDENTIFIER || '').trim()
    const password = String(env.BLUESKY_APP_PASSWORD || '').trim()
    if (!identifier || !password) {
      throw new Error('Set BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD before using Bluesky.')
    }

    return await this.connect(identifier, password, options)
  }

  /**
   * Disconnect one account. Its tokens are dropped and it disappears from
   * every list and default lookup; the row stays so its published posts keep
   * their attribution (and a later purge can still find them).
   */
  async disconnect(identityId: number): Promise<PublicAccount> {
    return toPublicAccount(await revokeIdentityRow('bluesky', identityId))
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

    const accountId = await this.ensureAccount()
    const postUuid = uuid()
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

    const result = await this.publishToPost({ id: Number(post.id), body }, external ? { external } : undefined)
    const finishedAt = now()

    if (!result.ok) {
      await database.updateTable('posts').set({
        status: 'failed',
        updated_at: finishedAt,
      }).where('id', '=', post.id).execute()

      throw new Error(result.error || 'Bluesky publish failed.')
    }

    await database.updateTable('posts').set({
      status: 'published',
      published_at: finishedAt,
      updated_at: finishedAt,
    }).where('id', '=', post.id).execute()

    return {
      post: { provider: 'bluesky', uri: result.uri || '', url: result.url },
      postId: Number(post.id),
      targetId: Number(result.targetId),
    }
  }

  /**
   * Publish an already-created post row to Bluesky as a new target. Never
   * throws — failures are recorded on the target and returned so a crosspost
   * to other providers can still proceed.
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
      return { provider: 'bluesky', ok: false, error: error instanceof Error ? error.message : String(error), identityId: identityId || undefined }
    }
    const account = { identityId: Number(identity.id), handle: identity.handle }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'bluesky',
        ok: false,
        error: `Bluesky posts must be ${this.driver.characterLimit} characters or fewer.`,
        ...account,
      }
    }

    const targetUuid = uuid()
    const createdAt = now()
    const publishInput = { text: post.body } as Parameters<BlueskyDriver['publish']>[1] & {
      external?: { uri: string, title: string, description?: string }
      reply?: { root: { uri: string, cid: string }, parent: { uri: string, cid: string } }
      media?: Array<{ bytes?: Uint8Array, mimeType?: string, altText?: string }>
    }
    if (content?.external) publishInput.external = content.external
    if (content?.reply) publishInput.reply = content.reply
    if (content?.media?.length) {
      // The driver embeds raw bytes; fetch URL-only media server-side.
      const media: Array<{ bytes: Uint8Array, mimeType?: string, altText?: string }> = []
      for (const item of content.media.slice(0, 4)) {
        if (item.bytes?.length) {
          media.push({ bytes: item.bytes, mimeType: item.mimeType, altText: item.altText })
        }
        else if (item.url) {
          try {
            const response = await fetch(item.url)
            if (!response.ok) continue
            const bytes = new Uint8Array(await response.arrayBuffer())
            media.push({
              bytes,
              mimeType: item.mimeType || response.headers.get('content-type') || 'image/jpeg',
              altText: item.altText,
            })
          }
          catch {}
        }
      }
      if (media.length) publishInput.media = media
    }

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
      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: published.uri,
        remote_cid: published.cid || null,
        failure_reason: null,
        updated_at: publishedAt,
      }).where('id', '=', target.id).execute()

      return {
        provider: 'bluesky',
        ok: true,
        url: published.url,
        uri: published.uri,
        cid: published.cid,
        targetId: Number(target.id),
        ...account,
      }
    }
    catch (error) {
      const message = describeBlueskyError(error)
      const failedAt = now()
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: failedAt,
      }).where('id', '=', target.id).execute()

      return { provider: 'bluesky', ok: false, error: message, targetId: Number(target.id), ...account }
    }
  }

  /**
   * Refresh engagement counts (likes/reposts/replies) for recently
   * published Bluesky targets into `post_targets.metrics`. Batched 25
   * URIs per API call; missing posts (deleted upstream) are skipped.
   *
   * Each target is read through the account that published it, so one
   * account's dead session only stalls its own posts. Targets from before
   * accounts were tracked (no `social_identity_id`), or from an account since
   * disconnected, go through the default account — post metrics are public, so
   * any live session can read them.
   */
  async syncMetrics(limit = 100): Promise<{ synced: number }> {
    let identities = (await listIdentityRows<SocialIdentityRow>('bluesky')).filter(hasSession)
    if (identities.length === 0) identities = [await this.requireIdentity()]
    const fallback = pickDefaultIdentity(identities, hasSession) || identities[0]!
    await this.ensureDriver()

    const targets = await database
      .selectFrom('post_targets')
      .select(['id', 'remote_uri', 'social_identity_id'])
      .where('provider', '=', 'bluesky')
      .where('status', '=', 'published')
      .where('remote_uri', 'like', 'at://%')
      .orderBy('id', 'desc')
      .limit(limit * identities.length)
      .execute()

    if (targets.length === 0) return { synced: 0 }

    const byIdentity = new Map<number, { identity: SocialIdentityRow, targets: any[] }>()
    for (const target of targets) {
      const owner = identities.find(identity => Number(identity.id) === Number(target.social_identity_id)) || fallback
      const group = byIdentity.get(Number(owner.id)) || { identity: owner, targets: [] }
      group.targets.push(target)
      byIdentity.set(Number(owner.id), group)
    }

    let synced = 0
    let firstError: unknown
    let anySucceeded = false
    for (const { identity, targets: owned } of byIdentity.values()) {
      try {
        synced += await this.syncMetricsFor(identity, owned.slice(0, limit))
        anySucceeded = true
      }
      catch (error) {
        firstError ??= error
      }
    }

    // One expired account must not hide the others' progress, but if nothing
    // synced at all the caller (the job, the metrics action) should hear why.
    if (!anySucceeded && firstError) throw firstError
    return { synced }
  }

  private async syncMetricsFor(identity: SocialIdentityRow, targets: any[]): Promise<number> {
    let current = identity
    let synced = 0
    for (let offset = 0; offset < targets.length; offset += 25) {
      const chunk = targets.slice(offset, offset + 25)
      const metrics = await this.withFreshSession(current, freshIdentity =>
        this.driver.postMetrics({
          handle: freshIdentity.handle,
          did: freshIdentity.external_id || undefined,
          accessToken: freshIdentity.access_token || undefined,
          refreshToken: freshIdentity.refresh_token || undefined,
        }, chunk.map((target: any) => String(target.remote_uri))), (refreshed) => { current = refreshed })

      const byUri = new Map(metrics.map(item => [item.uri, item]))
      for (const target of chunk) {
        const counts = byUri.get(String(target.remote_uri))
        if (!counts) continue
        await database.updateTable('post_targets').set({
          metrics: JSON.stringify({
            likes: counts.likeCount,
            reposts: counts.repostCount,
            replies: counts.replyCount,
            syncedAt: now(),
          }),
        }).where('id', '=', target.id).execute()
        synced += 1
      }
    }

    return synced
  }

  /** Pull one account's home timeline (the default account when none is named). */
  async syncTimeline(limit = 30, identityId?: number | null): Promise<TimelineResult & { saved: number }> {
    const identity = await this.requireIdentity(identityId)
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

  /**
   * The purge surface for Bluesky. Every call runs through `withFreshSession`
   * so a long-running purge survives the ~2h access-JWT lifetime, and the
   * refreshed identity is carried forward instead of re-refreshed each time.
   *
   * Pass an identity id to purge one specific account; without one this is the
   * default account, as before.
   */
  async purgeAdapter(identityId?: number | null): Promise<ProviderPurgeAdapter> {
    let current = await this.requireIdentity(identityId)
    const credentials = (identity: SocialIdentityRow) => ({
      handle: identity.handle,
      did: identity.external_id || undefined,
      accessToken: identity.access_token || undefined,
      refreshToken: identity.refresh_token || undefined,
    })
    const run = <T>(callback: (identity: SocialIdentityRow) => Promise<T>): Promise<T> =>
      this.withFreshSession(current, callback, (refreshed) => { current = refreshed })

    return {
      provider: 'bluesky',
      identityId: Number(current.id),
      handle: current.handle,
      listPage: cursor => run(identity => this.driver.listAuthoredPosts(credentials(identity), { cursor })),
      deletePost: ref => run(identity => this.driver.deletePost(credentials(identity), ref)),
    }
  }

  /**
   * Run `callback` against a live Bluesky session, refreshing the access JWT
   * once if it has expired.
   *
   * The DM transport talks to `chat.bsky.convo.*`, which the publishing driver
   * knows nothing about, but it needs exactly the session handling publishing
   * already has. Rather than give it a second copy of connect/refresh/expire,
   * this exposes the existing one.
   */
  async withSession<T>(
    callback: (credentials: SocialIdentityCredentials) => Promise<T>,
    identityId?: number | null,
  ): Promise<T> {
    const identity = await this.requireIdentity(identityId)

    return await this.withFreshSession(identity, current => callback({
      handle: current.handle,
      did: current.external_id || undefined,
      accessToken: current.access_token || undefined,
      refreshToken: current.refresh_token || undefined,
    }))
  }

  private async withFreshSession<T>(
    identity: SocialIdentityRow,
    callback: (identity: SocialIdentityRow) => Promise<T>,
    onRefresh?: (identity: SocialIdentityRow) => void,
  ): Promise<T> {
    try {
      return await callback(identity)
    }
    catch (error) {
      if (!(error instanceof BlueskyApiError) || !error.isAuthError || !identity.refresh_token) {
        throw error
      }

      // Access JWT expired — refresh once and retry. If the refresh token is
      // also dead, mark the identity expired so /accounts prompts a reconnect.
      let refreshed: SocialIdentityRow
      try {
        const session = await this.driver.refreshSession(identity.refresh_token)
        const driver = await this.ensureDriver()
        // `revive: false`: a refresh racing a disconnect must not undo it.
        refreshed = await this.saveSession(session, driver, { revive: false })
      }
      catch {
        await markIdentityExpired(identity.id)
        throw new Error(`Bluesky session for @${identity.handle} expired — reconnect it on the Accounts page.`)
      }
      onRefresh?.(refreshed)
      return await callback(refreshed)
    }
  }

  /**
   * The account to act as. A named account must be usable as-is — publishing
   * through a different one than the user picked would be worse than failing.
   * Without a name this is the default account, falling back to the
   * `.env` credentials exactly as it did before accounts were plural.
   */
  private async requireIdentity(identityId?: number | null): Promise<SocialIdentityRow> {
    if (identityId) {
      const chosen = await findIdentityRow<SocialIdentityRow>('bluesky', identityId)
      if (chosen && hasSession(chosen)) return chosen
      throw unavailableAccountError('Bluesky', chosen)
    }

    const existing = await findIdentityRow<SocialIdentityRow>('bluesky')
    if (existing && hasSession(existing)) return existing

    // Implicit, so it must not resurrect an account the user disconnected.
    const connected = await this.connectFromEnv({ revive: false })
    const identity = connected.id ? await findIdentityRow<SocialIdentityRow>('bluesky', connected.id) : undefined
    if (identity && hasSession(identity)) return identity

    throw new Error('Connect Bluesky before publishing.')
  }

  /**
   * Save a session against the account it belongs to. Keyed on the DID, which
   * survives handle changes; the handle only matches legacy rows saved without
   * one. A different DID is a different account and gets its own row.
   */
  private async saveSession(
    session: BlueskySession,
    driver: SocialDriverRow,
    options: { revive?: boolean } = {},
  ): Promise<SocialIdentityRow> {
    const accountId = await this.ensureAccount()
    const handle = normalizeHandle(session.handle)

    return await upsertIdentityRow<SocialIdentityRow>('bluesky', { externalId: session.did, handle }, {
      handle,
      display_name: session.displayName || null,
      provider: 'bluesky',
      external_id: session.did,
      auth_status: 'connected',
      access_token: session.accessJwt,
      refresh_token: session.refreshJwt,
      account_id: accountId,
      social_driver_id: driver.id,
    }, { revive: options.revive, label: 'This Bluesky' })
  }

  private toAccounts(rows: SocialIdentityRow[], fallback: SocialIdentityRow | undefined): PublicAccount[] {
    return rows.map(row => toPublicAccount(row, { isDefault: Number(row.id) === Number(fallback?.id) }))
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
      workspace_name: 'The Open Times',
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
