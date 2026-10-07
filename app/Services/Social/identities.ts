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

import type { IdentityKey, IdentityLike } from '../../Support/Social/accounts'
import { db } from '@stacksjs/database'
import { matchIdentity, pickDefaultIdentity } from '../../Support/Social/accounts'
import { now, uuid } from './support'

const database = db as any

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
  if (!options.includeRevoked) query = query.where('auth_status', '!=', 'revoked')

  return await query.orderBy('updated_at', 'desc').execute() as T[]
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
    return await database
      .selectFrom('social_identities')
      .selectAll()
      .where('id', '=', identityId)
      .where('provider', '=', provider)
      .executeTakeFirst() as T | undefined
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

  if (existing) {
    if (existing.auth_status === 'revoked' && options.revive === false) {
      throw new Error(`${options.label || 'This'} account was disconnected. Reconnect it on the Accounts page to publish with it again.`)
    }

    await database.updateTable('social_identities')
      .set({ ...values, provider, updated_at: savedAt })
      .where('id', '=', existing.id)
      .execute()

    return await database
      .selectFrom('social_identities')
      .selectAll()
      .where('id', '=', existing.id)
      .executeTakeFirstOrThrow() as T
  }

  const identityUuid = uuid()
  await database.insertInto('social_identities').values({
    uuid: identityUuid,
    ...values,
    provider,
    created_at: savedAt,
    updated_at: savedAt,
  }).execute()

  return await database
    .selectFrom('social_identities')
    .selectAll()
    .where('uuid', '=', identityUuid)
    .executeTakeFirstOrThrow() as T
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
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
  }).where('id', '=', row.id).execute()

  return { ...row, auth_status: 'revoked', access_token: null }
}

/**
 * Flag an account whose token the network rejected, so /accounts prompts a
 * reconnect. Never downgrades a revoked row back into view.
 */
export async function markIdentityExpired(identityId: number): Promise<void> {
  await database.updateTable('social_identities')
    .set({ auth_status: 'expired', updated_at: now() })
    .where('id', '=', identityId)
    .where('auth_status', '!=', 'revoked')
    .execute()
}

/** The error a service returns when an explicitly chosen account is unusable. */
export function unavailableAccountError(label: string, row: IdentityLike | undefined): Error {
  if (!row) return new Error(`That ${label} account is not connected.`)
  if (row.auth_status === 'revoked') return new Error(`${label} account @${row.handle.replace(/^@/, '')} was disconnected. Reconnect it on the Accounts page.`)
  return new Error(`${label} account @${row.handle.replace(/^@/, '')} needs reconnecting on the Accounts page.`)
}
