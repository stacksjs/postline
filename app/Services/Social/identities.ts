/**
 * The `social_identities` reads and writes every network service shares.
 *
 * Each service used to carry its own copy of "find the newest row for my
 * provider" and "update it in place, else insert", which hard-wired one
 * account per network: connecting a second Bluesky handle silently replaced
 * the first. The lookup and the upsert now live here, once, addressed by
 * identity id where the caller has one and falling back to the network's
 * default account where it does not. The matching rules themselves are pure
 * and live in `Support/Social/accounts.ts`.
 *
 * Revoked rows (disconnected accounts) are kept, not deleted: `post_targets`,
 * `timeline_items`, `dm_conversations` and purge history all point at them.
 * They are hidden from every default lookup and listing instead.
 */

import type { ArchivedTargetAccount, IdentityKey, IdentityLike } from '../../Support/Social/accounts'
import type { PublishTarget } from '../../Support/Social/targets'
import { db } from '@stacksjs/database'
import { UserFacingError } from '../../Support/Http/user-error'
import { alerts } from '../AlertService'
import { matchArchivedTargetAccount, matchIdentity, pickDefaultIdentity, reconnectArchivedTargetMessage } from '../../Support/Social/accounts'
import { isSealed, openToken, sealToken } from '../../Support/Social/token-vault'
import { now, uuid } from './support'

const database = db as any

export function assertThreadTransport(targets: readonly PublishTarget[], tx = database): void {
  const twitterIds = targets.flatMap(target => target.provider === 'twitter' && target.identityId ? [target.identityId] : [])
  if (twitterIds.length && tx.selectFrom('social_identities').select('id').where('id', 'in', twitterIds)
    .where('auth_transport', '=', 'browser').executeTakeFirst())
    throw new UserFacingError('Choose the X API account for a thread. The X browser currently publishes single posts.')
}

export class RestoredTargetAccountError extends UserFacingError {
  constructor(account: ArchivedTargetAccount) {
    super(reconnectArchivedTargetMessage(account), 'restored_target_account_unavailable')
  }
}

interface RestoredTargetRow {
  id: number
  social_identity_id?: number | null
  archived_account?: string | null
}

/** Bind portable account references before claiming or sending their posts. */
export function bindRestoredTargets<T extends RestoredTargetRow>(tx: typeof database, rows: T[]): T[] {
  if (!rows.some(row => row.archived_account)) return rows

  const identities: IdentityLike[] = tx.selectFrom('social_identities')
    .select(['id', 'provider', 'handle', 'external_id', 'auth_status', 'auth_transport']).execute()
  return rows.map((row) => {
    if (!row.archived_account) return row
    const account: ArchivedTargetAccount = JSON.parse(row.archived_account)
    const identity = matchArchivedTargetAccount(identities, account)
    if (!identity) throw new RestoredTargetAccountError(account)

    const changes = { social_identity_id: Number(identity.id), archived_account: null }
    tx.updateTable('post_targets').set(changes).where('id', '=', row.id).execute()
    return { ...row, ...changes }
  })
}

const TOKEN_COLUMNS = ['access_token', 'refresh_token', 'insights_access_token', 'instagram_comments_access_token'] as const
type TokenColumns = Record<typeof TOKEN_COLUMNS[number], string | null>
// A reconnect encrypts fresh ciphertext even when the credential string is
// unchanged. Keep that stored generation out of the public identity object.
const tokenSnapshots = new WeakMap<object, TokenColumns>()

function updateCurrentIdentity(identity: IdentityLike, values: Record<string, unknown>) {
  const tokens = tokenSnapshots.get(identity)
  if (!tokens) return
  return database.updateTable('social_identities').set(values)
    .where('id', '=', identity.id)
    .where('provider', '=', identity.provider)
    .where('auth_status', '=', identity.auth_status)
    .where('access_token', tokens.access_token == null ? 'is' : '=', tokens.access_token)
    .where('refresh_token', tokens.refresh_token == null ? 'is' : '=', tokens.refresh_token)
    .where('insights_access_token', tokens.insights_access_token == null ? 'is' : '=', tokens.insights_access_token)
    .where('instagram_comments_access_token', tokens.instagram_comments_access_token == null ? 'is' : '=', tokens.instagram_comments_access_token)
}

/**
 * A row as the rest of the app sees it: tokens readable.
 *
 * Everything outside this file works with plain tokens and never learns they
 * are stored sealed. A token this install cannot read is treated as absent, so
 * the account shows as needing a reconnect instead of failing every listing.
 */
export async function openIdentityRow<T>(row: T): Promise<T>
export async function openIdentityRow<T>(row: T | undefined): Promise<T | undefined>
export async function openIdentityRow<T>(row: T | undefined): Promise<T | undefined> {
  if (!row)
    return row

  const opened = { ...row } as Record<string, unknown>
  tokenSnapshots.set(opened, {
    access_token: typeof opened.access_token === 'string' ? opened.access_token : null,
    refresh_token: typeof opened.refresh_token === 'string' ? opened.refresh_token : null,
    insights_access_token: typeof opened.insights_access_token === 'string' ? opened.insights_access_token : null,
    instagram_comments_access_token: typeof opened.instagram_comments_access_token === 'string' ? opened.instagram_comments_access_token : null,
  })
  for (const column of TOKEN_COLUMNS) {
    if (typeof opened[column] !== 'string')
      continue
    try {
      opened[column] = await openToken(opened[column] as string)
    }
    catch {
      opened[column] = null
    }
  }
  return opened as T
}

/** Seal whichever token columns a write carries. */
async function sealValues(values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sealed = { ...values }
  for (const column of TOKEN_COLUMNS) {
    if (column in sealed)
      sealed[column] = await sealToken(sealed[column] as string | null | undefined)
  }
  return sealed
}

let sealing: Promise<number> | undefined

/**
 * Seal every token still stored in the clear. Runs once per process, the first
 * time the table is read or written, which is what upgrades an install that
 * connected its accounts before tokens were sealed. Returns how many rows it
 * rewrote.
 */
export function sealStoredTokens(): Promise<number> {
  sealing ??= (async () => {
    const rows = await database
      .selectFrom('social_identities')
      .select(['id', ...TOKEN_COLUMNS])
      .execute() as Array<{ id: number } & TokenColumns>

    let rewritten = 0
    for (const row of rows) {
      const plain = TOKEN_COLUMNS.filter(column => row[column] && !isSealed(row[column]))
      if (plain.length === 0)
        continue

      const values: Record<string, unknown> = {}
      for (const column of plain) values[column] = await sealToken(row[column])
      const updated = await database.updateTable('social_identities').set(values)
        .where('id', '=', row.id)
        .where('access_token', row.access_token == null ? 'is' : '=', row.access_token)
        .where('refresh_token', row.refresh_token == null ? 'is' : '=', row.refresh_token)
        .where('insights_access_token', row.insights_access_token == null ? 'is' : '=', row.insights_access_token)
        .where('instagram_comments_access_token', row.instagram_comments_access_token == null ? 'is' : '=', row.instagram_comments_access_token)
        .returning('id')
        .executeTakeFirst()
      if (updated) rewritten++
    }
    return rewritten
  })().catch((error) => {
    // Try again on the next call rather than remembering the failure.
    sealing = undefined
    throw error
  })

  return sealing
}

/** For tests: forget that the sealing pass has run. */
export function resetTokenSealing(): void {
  sealing = undefined
}

/** Update only the credential generation sent to the network. */
export async function saveIdentityTokens<T extends IdentityLike>(identity: T, values: Record<string, unknown>): Promise<T | undefined> {
  const update = updateCurrentIdentity(identity, await sealValues(values))
  const row = await update?.returningAll().executeTakeFirst() as T | undefined
  return await openIdentityRow(row)
}

/**
 * Every account row for a network, newest first. Revoked rows are excluded
 * unless asked for — the only caller that wants them is the upsert, so a
 * reconnect can revive a disconnected account's row.
 */
export async function listIdentityRows<T extends IdentityLike>(
  provider: string,
  options: { includeRevoked?: boolean } = {},
): Promise<T[]> {
  let query = database
    .selectFrom('social_identities')
    .selectAll()
    .where('provider', '=', provider)
  if (provider === 'twitter') query = query.where('auth_transport', '=', 'api')
  if (!options.includeRevoked) query = query.where('auth_status', '!=', 'revoked')

  await sealStoredTokens()
  const rows = await query.orderBy('updated_at', 'desc').execute() as T[]
  return await Promise.all(rows.map(row => openIdentityRow(row)))
}

/**
 * One account row. With an id, exactly that row (revoked or not — the caller
 * decides what a revoked row means); without, the network's default account.
 */
export async function findIdentityRow<T extends IdentityLike>(
  provider: string,
  identityId?: number | null,
  usable?: (row: T) => boolean,
): Promise<T | undefined> {
  if (identityId) {
    await sealStoredTokens()
    return await openIdentityRow(await database
      .selectFrom('social_identities')
      .selectAll()
      .where('id', '=', identityId)
      .where('provider', '=', provider)
      .executeTakeFirst() as T | undefined)
  }

  return pickDefaultIdentity(await listIdentityRows<T>(provider), usable)
}

/**
 * Save a fresh session: refresh the row for this account, or add one.
 *
 * `revive` controls whether a disconnected account may be brought back. An
 * explicit connect from the Accounts page should; an implicit one (a publish
 * quietly falling back to the token in `.env`) must not, or disconnecting an
 * account would last only until the next scheduled post.
 */
export async function upsertIdentityRow<T extends IdentityLike>(
  provider: string,
  key: IdentityKey,
  values: Record<string, unknown>,
  options: { revive?: boolean, label?: string } = {},
): Promise<T> {
  const rows = await listIdentityRows<T>(provider, { includeRevoked: true })
  const existing = matchIdentity(rows, key)
  const savedAt = now()
  values = await sealValues(values)

  if (existing) {
    const valuesToSave = { ...values, provider, updated_at: savedAt }
    if (existing.auth_status === 'revoked' && options.revive === false)
      throw new Error(`${options.label || 'This'} account was disconnected. Reconnect it on the Accounts page to publish with it again.`)
    const update = options.revive === false
      ? updateCurrentIdentity(existing, valuesToSave)
      : database.updateTable('social_identities').set(valuesToSave).where('id', '=', existing.id)
    const saved = await update?.returningAll().executeTakeFirst()
    if (!saved)
      throw new Error(`${options.label || 'This'} account changed. Reconnect it on the Accounts page to publish with it again.`)
    return await openIdentityRow(saved as T)
  }

  // The first account on a network is its default. A later one never takes
  // the flag by being connected: that is the owner's choice.
  const hasDefault = rows.some(row => row.auth_status !== 'revoked' && Boolean(row.is_default))

  const identityUuid = uuid()
  await database.insertInto('social_identities').values({
    uuid: identityUuid,
    ...values,
    provider,
    is_default: !hasDefault,
    created_at: savedAt,
    updated_at: savedAt,
  }).execute()

  return await openIdentityRow(await database
    .selectFrom('social_identities')
    .selectAll()
    .where('uuid', '=', identityUuid)
    .executeTakeFirstOrThrow() as T)
}

/**
 * Disconnect an account: drop its tokens and mark it revoked.
 *
 * Deliberately not a delete. Its published targets, timeline rows and DM
 * threads keep pointing at it, which is what lets the queue keep showing whose
 * post it was and a later purge still find what it published.
 */
export async function revokeIdentityRow(provider: string, identityId: number): Promise<IdentityLike> {
  const row = await findIdentityRow(provider, identityId)
  if (!row) throw new Error('That account is not connected.')

  // `updated_at` is left alone on purpose. Code outside these services still
  // picks "the newest row for a provider" (DM conversation attribution), and
  // bumping it here would make a just-disconnected account the newest one.
  await database.updateTable('social_identities').set({
    auth_status: 'revoked',
    // A disconnected account is nobody's default. The next one in line is
    // chosen by `pickDefaultIdentity` until the owner marks another.
    is_default: false,
    access_token: null,
    refresh_token: null,
    insights_access_token: null,
    instagram_comments_access_token: null,
    token_expires_at: null,
  }).where('id', '=', row.id).execute()

  return { ...row, auth_status: 'revoked', access_token: null, refresh_token: null, insights_access_token: null, instagram_comments_access_token: null }
}

/**
 * Make one account its network's default. Exactly one row per network holds
 * the flag afterwards.
 */
export async function setDefaultIdentityRow(identityId: number): Promise<IdentityLike> {
  const row = await database
    .selectFrom('social_identities')
    .selectAll()
    .where('id', '=', identityId)
    .executeTakeFirst() as IdentityLike | undefined
  if (!row || row.auth_status === 'revoked') throw new UserFacingError('That account is not connected.')
  if (row.auth_transport === 'browser') throw new UserFacingError('Select the X browser account explicitly when you want to publish through it.')

  await database.updateTable('social_identities').set({ is_default: false }).where('provider', '=', row.provider).execute()
  await database.updateTable('social_identities').set({ is_default: true }).where('id', '=', row.id).execute()
  return { ...(await openIdentityRow(row))!, is_default: true }
}

/**
 * Flag an account whose token the network rejected, so /accounts prompts a
 * reconnect. Never downgrades a revoked row back into view.
 */
export async function markIdentityExpired(identity: IdentityLike): Promise<void> {
  if (identity.auth_status === 'revoked') return
  const expired = await updateCurrentIdentity(identity, { auth_status: 'expired', updated_at: now() })
    ?.returning(['provider', 'handle'])
    .executeTakeFirst()
  if (!expired) return

  // Announce only a credential generation that the database actually expired.
  await alerts.raise({
    kind: 'account-expired',
    title: `${String(expired.provider).replace(/^./, (letter: string) => letter.toUpperCase())} account ${expired.handle} needs reconnecting`,
    body: 'The network turned its sign-in down. Posts to it will fail until you connect it again under Settings, Channels.',
    link: '/accounts',
    key: `account-expired:${identity.id}:${now().slice(0, 10)}`,
  })
}

/** The error a service returns when an explicitly chosen account is unusable. */
export function unavailableAccountError(label: string, row: IdentityLike | undefined): Error {
  if (!row) return new Error(`That ${label} account is not connected.`)
  if (row.auth_status === 'revoked') return new Error(`${label} account @${row.handle.replace(/^@/, '')} was disconnected. Reconnect it on the Accounts page.`)
  return new Error(`${label} account @${row.handle.replace(/^@/, '')} needs reconnecting on the Accounts page.`)
}
