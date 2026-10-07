import type { PublicAccount } from '../../Support/Social/accounts'
import type { CrosspostTargetResult, ProviderPurgeAdapter, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isUsableIdentity, pickDefaultIdentity, toPublicAccount } from '../../Support/Social/accounts'
import { MastodonApiError, MastodonDriver, normalizeInstance } from './Drivers/MastodonDriver'
import { findIdentityRow, listIdentityRows, markIdentityExpired, revokeIdentityRow, unavailableAccountError, upsertIdentityRow } from './identities'
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

  /**
   * The network card's state: top-level fields describe the default account
   * (unchanged for existing callers), `accounts` lists every connected one —
   * which, on Mastodon, may span several instances.
   */
  async status() {
    const rows = await listIdentityRows<SocialIdentityRow>('mastodon')
    const identity = pickDefaultIdentity(rows)
    const cfg = this.config()
    const connected = identity?.auth_status === 'connected' && Boolean(identity.access_token)

    return {
      connected,
      provider: 'mastodon',
      id: identity ? Number(identity.id) : null,
      handle: identity?.handle || null,
      displayName: identity?.display_name || null,
      instance: identity?.external_id || null,
      authStatus: connected ? 'connected' : (identity?.handle ? identity.auth_status : 'missing'),
      characterLimit: this.driver.characterLimit,
      canPublish: connected,
      requiresMedia: false,
      configuredFromEnv: Boolean(cfg.instance && cfg.accessToken),
      accounts: rows.map(row => toPublicAccount(row, { isDefault: Number(row.id) === Number(identity?.id) })),
    }
  }

  async listAccounts(): Promise<PublicAccount[]> {
    return (await this.status()).accounts
  }

  /** The account a bare `mastodon` target publishes through, without connecting anything. */
  async defaultIdentityId(): Promise<number | null> {
    const identity = await findIdentityRow<SocialIdentityRow>('mastodon')
    return isUsableIdentity(identity) ? Number(identity!.id) : null
  }

  /** Disconnect one account: token dropped, row kept for its posts' history. */
  async disconnect(identityId: number): Promise<PublicAccount> {
    return toPublicAccount(await revokeIdentityRow('mastodon', identityId))
  }

  /**
   * Connect with an instance URL + personal access token. The same account
   * again refreshes its token; another account — on this instance or any
   * other — is added alongside.
   */
  async connect(input: { instance: string, accessToken: string }, options: { revive?: boolean } = {}) {
    const instance = normalizeInstance(input.instance)
    const accessToken = String(input.accessToken || '').trim()
    if (!accessToken)
      throw new Error('A Mastodon access token is required.')

    const account = await this.driver.verifyCredentials({ handle: '', did: instance, accessToken })
    const identity = await this.saveSession({ instance, accessToken, account }, { revive: options.revive ?? true })
    return this.publicIdentity(identity)
  }

  /**
   * Connect from `.env`. `revive: false` is the implicit path (a publish
   * falling back to it), which must not bring back a disconnected account.
   */
  async connectFromEnv(options: { revive?: boolean } = {}) {
    const cfg = this.config()
    if (!cfg.instance || !cfg.accessToken)
      throw new Error('Set MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN, or connect on the Accounts page.')
    return this.connect(cfg, options)
  }

  /**
   * Publish an already-created post row to Mastodon. Never throws — failures
   * are recorded on the target and returned so other crosspost providers
   * still succeed.
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
      return { provider: 'mastodon', ok: false, error: messageOf(error), identityId: identityId || undefined }
    }
    const account = { identityId: Number(identity.id), handle: identity.handle }

    if (post.body.length > this.driver.characterLimit) {
      return {
        provider: 'mastodon',
        ok: false,
        error: `Mastodon posts must be ${this.driver.characterLimit} characters or fewer.`,
        ...account,
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
        this.credentialsFor(identity),
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
        ...account,
      }
    }
    catch (error) {
      const message = messageOf(error)
      if (error instanceof MastodonApiError && error.isAuthError)
        await markIdentityExpired(identity.id)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'mastodon', ok: false, error: message, targetId: Number(target.id), ...account }
    }
  }

  /**
   * The purge surface for Mastodon. Personal access tokens don't expire, so
   * the identity is resolved once. Deletes key on the status id — which is
   * stored in `remote_cid`, since `remote_uri` holds the public status URL.
   *
   * Pass an identity id to purge one specific account; without one this is the
   * default account, as before.
   */
  async purgeAdapter(identityId?: number | null): Promise<ProviderPurgeAdapter> {
    const identity = await this.requireIdentity(identityId)
    const credentials = this.credentialsFor(identity)

    return {
      provider: 'mastodon',
      identityId: Number(identity.id),
      handle: identity.handle,
      listPage: cursor => this.driver.listAuthoredPosts(credentials, { cursor }),
      // The driver falls back to the id in a stored status URL, which is what
      // `remote_uri` holds for Mastodon targets.
      deletePost: ref => this.driver.deletePost(credentials, ref),
    }
  }

  /**
   * The framework credential shape. Mastodon has no single host, so the
   * instance base URL travels in `did` — the slot LinkedIn uses for the member
   * URN and Instagram for the account id.
   */
  private credentialsFor(identity: SocialIdentityRow) {
    return {
      handle: identity.handle,
      did: identity.external_id || undefined,
      accessToken: identity.access_token || undefined,
    }
  }

  /**
   * The credentials the DM transport needs. `handle` is the full
   * `@user@instance` form, which is what a direct status has to be addressed
   * to for the reply to reach the same thread.
   */
  async dmIdentity(identityId?: number | null): Promise<{ identityId: number, instance: string, accessToken: string, handle: string }> {
    const identity = await this.requireIdentity(identityId)
    if (!identity.external_id)
      throw new Error('Reconnect Mastodon on the Accounts page — The Open Times needs your instance URL.')

    return {
      identityId: Number(identity.id),
      instance: String(identity.external_id),
      accessToken: String(identity.access_token),
      handle: identity.handle,
    }
  }

  /**
   * The account to act as. A named account must be usable as-is; without a
   * name this is the default account, falling back to the `.env` token.
   */
  private async requireIdentity(identityId?: number | null): Promise<SocialIdentityRow> {
    if (identityId) {
      const chosen = await findIdentityRow<SocialIdentityRow>('mastodon', identityId)
      if (isUsableIdentity(chosen)) return chosen!
      throw unavailableAccountError('Mastodon', chosen)
    }

    const existing = await findIdentityRow<SocialIdentityRow>('mastodon')
    if (isUsableIdentity(existing)) return existing!

    const cfg = this.config()
    if (cfg.instance && cfg.accessToken) {
      const connected = await this.connectFromEnv({ revive: false })
      const identity = connected.id ? await findIdentityRow<SocialIdentityRow>('mastodon', connected.id) : undefined
      if (identity?.access_token) return identity
    }

    throw new Error('Connect Mastodon before publishing.')
  }

  /**
   * Save a token against the account it belongs to.
   *
   * Keyed on the full `@user@host` handle, not `external_id`: that column holds
   * the instance URL (the credentials and DM transport read it from there), so
   * every account on one instance shares it. Mastodon usernames cannot be
   * changed, so the handle is as stable as an account id and already carries
   * the instance — two accounts on one instance, or the same username on two
   * instances, stay distinct.
   */
  private async saveSession(
    input: { instance: string, accessToken: string, account: { accountId: string, username: string, displayName?: string, url: string } },
    options: { revive?: boolean } = {},
  ): Promise<SocialIdentityRow> {
    const accountId = await ensureAccount()
    const driver = await this.ensureDriver()
    const host = input.instance.replace(/^https?:\/\//, '')
    const handle = `@${input.account.username}@${host}`

    return await upsertIdentityRow<SocialIdentityRow>('mastodon', { handle }, {
      handle,
      display_name: input.account.displayName || input.account.username,
      provider: 'mastodon',
      external_id: input.instance,
      auth_status: 'connected',
      access_token: input.accessToken,
      refresh_token: null,
      account_id: accountId,
      social_driver_id: driver.id,
    }, { revive: options.revive, label: 'This Mastodon' })
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
      return { connected: false, provider: 'mastodon', id: null, handle: null, displayName: null, instance: null, authStatus: 'missing' }
    }
    const connected = row.auth_status === 'connected' && Boolean(row.access_token)
    return {
      connected,
      provider: 'mastodon',
      id: Number(row.id),
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
