/**
 * Connected-account rules that do not need a database.
 *
 * A network can have several `social_identities` rows — two Bluesky handles,
 * an X account per brand, Mastodon accounts on different instances. The
 * decisions that make that safe are pure functions of the rows, so they live
 * here where tests can reach them without a database:
 *
 * - which existing row a fresh login refreshes (`matchIdentity`), so
 *   reconnecting an account updates it while a different account is added
 *   alongside instead of overwriting the first;
 * - which row is the network's default (`pickDefaultIdentity`), for every
 *   caller that still asks for "the" Bluesky account.
 */

export type IdentityAuthStatus = 'connected' | 'expired' | 'revoked' | 'missing'

/** The columns these rules read. Service row types are structurally wider. */
export interface IdentityLike {
  id: number
  provider: string
  handle: string
  display_name?: string | null
  external_id?: string | null
  auth_status: IdentityAuthStatus
  access_token?: string | null
}

/**
 * What identifies one account across logins.
 *
 * `externalId` is the stable id the network assigns (Bluesky DID, X user id,
 * LinkedIn member URN, Instagram/Threads user id) and always wins: handles can
 * be renamed, ids cannot. `handle` is the fallback, used when the network has
 * no stable id we store — Mastodon, whose `external_id` column holds the
 * instance URL rather than an account id, so its handle (`@user@host`, which
 * already carries the instance) is the key — and for legacy rows saved before
 * an external id was recorded.
 */
export interface IdentityKey {
  externalId?: string | null
  handle?: string | null
}

export function normalizeIdentityHandle(handle: string | null | undefined): string {
  return String(handle || '').trim().replace(/^@/, '').toLowerCase()
}

/**
 * The row a fresh session for `key` should update, or undefined to insert.
 *
 * Revoked rows still match. Reconnecting an account the user disconnected
 * brings its history back with it rather than leaving a revoked twin behind;
 * whether a match on a revoked row is allowed at all is the caller's call.
 */
export function matchIdentity<T extends IdentityLike>(rows: readonly T[], key: IdentityKey): T | undefined {
  const externalId = String(key.externalId || '').trim()
  if (externalId) {
    const byId = rows.find(row => String(row.external_id || '').trim() === externalId)
    if (byId) return byId
  }

  const handle = normalizeIdentityHandle(key.handle)
  if (!handle) return undefined

  return rows.find((row) => {
    if (normalizeIdentityHandle(row.handle) !== handle) return false
    // With an external id on both sides, a matching handle on a row with a
    // DIFFERENT id is a different account that once held this handle (a
    // Bluesky handle released and re-registered). Only a row with no id of its
    // own, or a key with none to compare, can be matched by handle.
    return !externalId || !String(row.external_id || '').trim()
  })
}

/** A row the services can publish with today: connected and holding a token. */
export function isUsableIdentity(row: Pick<IdentityLike, 'auth_status' | 'access_token'> | undefined | null): boolean {
  return Boolean(row && row.auth_status === 'connected' && row.access_token)
}

/**
 * The network's default account among `rows` (ordered most recently updated
 * first): the newest usable one, else the newest that is not revoked, so a
 * status card can still say "reconnect @handle" when nothing is usable.
 *
 * `usable` is overridable because Bluesky treats an expired row with a refresh
 * token as usable — its session refresh can revive it mid-request.
 */
export function pickDefaultIdentity<T extends IdentityLike>(
  rows: readonly T[],
  usable: (row: T) => boolean = isUsableIdentity,
): T | undefined {
  const live = rows.filter(row => row.auth_status !== 'revoked')
  return live.find(usable) || live[0]
}

/** The account shape every API response and page uses. Never carries tokens. */
export interface PublicAccount {
  id: number
  provider: string
  handle: string
  displayName: string | null
  authStatus: IdentityAuthStatus
  connected: boolean
  canPublish: boolean
  /** True for the account a bare network target publishes through. */
  isDefault: boolean
  /** Mastodon only: the instance base URL. */
  instance?: string | null
  /** No avatar is stored yet; present so clients can rely on the key. */
  avatar: string | null
}

export function toPublicAccount(row: IdentityLike, options: { isDefault?: boolean, canPublish?: boolean } = {}): PublicAccount {
  const connected = isUsableIdentity(row)
  return {
    id: Number(row.id),
    provider: row.provider,
    handle: row.handle,
    displayName: row.display_name || null,
    authStatus: connected ? 'connected' : row.auth_status === 'revoked' ? 'revoked' : row.auth_status === 'expired' ? 'expired' : 'missing',
    connected,
    canPublish: options.canPublish ?? connected,
    isDefault: Boolean(options.isDefault),
    ...(row.provider === 'mastodon' ? { instance: row.external_id || null } : {}),
    avatar: null,
  }
}
