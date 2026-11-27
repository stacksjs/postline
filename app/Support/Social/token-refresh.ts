/**
 * Refresh a network token once, however many callers want it.
 *
 * X hands out a new refresh token on every refresh and cancels the old one.
 * The API process and the scheduler both publish, so two of them could send
 * the same refresh token a moment apart: one wins and the other is left with
 * a token the network has just cancelled, which disconnects the account.
 *
 * Two guards stop that. Inside one process, callers for the same account
 * share one promise. Across processes, a lease in the workspace database
 * lets one renewal run. A caller that waited reloads the stored identity
 * before deciding whether it needs a refresh.
 *
 * A refresh the network refuses marks the account as needing a reconnect, so
 * the owner sees it on Channels before a post fails. A refresh that fails for
 * any other reason (the network is down) is logged and tried again later.
 */
import { log } from '@stacksjs/logging'
import { acquireSocialOperationLease } from '../Database/operation-lease'

const MINUTE = 60
const DAY = 24 * 60 * 60

/**
 * How long before expiry each network's token is renewed. One number for all
 * of them meant an X token, which lasts two hours, was always "expiring soon"
 * and was refreshed on every call.
 */
export const REFRESH_BEFORE_SECONDS: Record<string, number> = {
  twitter: 10 * MINUTE,
  linkedin: 7 * DAY,
  threads: 7 * DAY,
  instagram: 7 * DAY,
}

/** How far ahead the owner is warned about a token nothing can renew. */
export const EXPIRY_WARNING_SECONDS: number = 7 * DAY

/** A refresh is one request; a lock older than this was left by a dead process. */
const LOCK_STALE_MS = 60 * 1000
const LOCK_WAIT_MS = 15 * 1000

export interface RefreshableIdentity {
  id: number
  provider: string
  handle?: string
  access_token?: string | null
  refresh_token?: string | null
  token_expires_at?: string | null
}

export function refreshWindow(provider: string): number {
  return REFRESH_BEFORE_SECONDS[provider] ?? 7 * DAY
}

/** Seconds until a stored `YYYY-MM-DD HH:MM:SS` (UTC) expiry, or null when unknown. */
export function secondsUntil(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!value) return null
  const expiry = Date.parse(`${String(value).replace(' ', 'T')}Z`)
  if (Number.isNaN(expiry)) return null
  return Math.round((expiry - nowMs) / 1000)
}

export function needsRefresh(identity: RefreshableIdentity, nowMs: number = Date.now()): boolean {
  const left = secondsUntil(identity.token_expires_at, nowMs)
  return left !== null && left <= refreshWindow(identity.provider)
}

/**
 * Whether the network turned the refresh down, as opposed to not answering.
 * Only a refusal means the account has to be reconnected.
 */
export function isRefusedRefresh(error: unknown): boolean {
  const status = Number((error as { status?: unknown } | null)?.status)
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return true
  const message = error instanceof Error ? error.message : String(error)
  return /invalid_grant|invalid_token|token (?:has )?(?:expired|been revoked)/i.test(message)
}

const inFlight = new Map<number, Promise<RefreshableIdentity | undefined>>()

export interface RefreshSteps<T extends RefreshableIdentity> {
  /** Read the account again from the database. */
  reload: () => Promise<T | undefined>
  /** Ask the network for new tokens and store them. Returns the updated row. */
  refresh: (current: T) => Promise<T | undefined>
  /** Called when the network refuses: the account needs reconnecting. */
  refused: (current: T) => Promise<void>
  /** For tests. */
  wait?: (ms: number) => Promise<void>
}

/**
 * Return the account with a token that is good for a while yet, refreshing it
 * at most once across every caller and process.
 */
export async function refreshOnce<T extends RefreshableIdentity>(identity: T, steps: RefreshSteps<T>): Promise<T | undefined> {
  if (!needsRefresh(identity)) return identity

  const running = inFlight.get(identity.id) as Promise<T | undefined> | undefined
  if (running) return await running

  const work = run(identity, steps).finally(() => inFlight.delete(identity.id))
  inFlight.set(identity.id, work)
  return await work
}

async function run<T extends RefreshableIdentity>(identity: T, steps: RefreshSteps<T>): Promise<T | undefined> {
  const key = `token-refresh:${identity.id}`
  const wait = steps.wait ?? ((ms: number) => new Promise<void>(done => setTimeout(done, ms)))
  let lease = acquireSocialOperationLease(key, LOCK_STALE_MS)
  const deadline = Date.now() + LOCK_WAIT_MS
  while (!lease && Date.now() < deadline) {
    const current = await steps.reload()
    if (!current || !needsRefresh(current)) return current
    await wait(150)
    lease = acquireSocialOperationLease(key, LOCK_STALE_MS)
  }

  let heartbeat: ReturnType<typeof setInterval> | undefined
  try {
    // Re-read after taking the lease. Another process may have rotated the
    // credential while this one was waiting.
    const current = await steps.reload()
    if (!current || !needsRefresh(current)) return current
    if (!lease?.renew()) return current
    const owner = lease
    heartbeat = setInterval(() => owner.renew(), LOCK_STALE_MS / 3)
    heartbeat.unref()

    try {
      const refreshed = await steps.refresh(current)
      if (refreshed) return refreshed
    }
    catch (error) {
      const statusCode = Number((error as { status?: unknown } | null)?.status)
      const status = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? ` (HTTP ${statusCode})` : ''
      const who = `${current.provider} account ${current.handle ?? current.id}`
      if (isRefusedRefresh(error)) {
        if (!owner.renew()) return await steps.reload()
        log.error(`[postline] ${who} could not renew its token${status} and needs reconnecting.`)
        await steps.refused(current)
      }
      else {
        log.warn(`[postline] ${who} could not renew its token${status}. Postline will try again.`)
      }
    }
    return await steps.reload()
  }
  finally {
    clearInterval(heartbeat)
    lease?.release()
  }
}

export type TokenRenewal = 'automatic' | 'reconnect' | 'none'

/**
 * What the owner needs to know about a token's lifetime.
 *
 * `automatic`: Postline renews it, nothing to do. `reconnect`: it will lapse
 * and only signing in again replaces it. `none`: it does not expire.
 */
export function tokenLifetime(
  identity: RefreshableIdentity,
  nowMs: number = Date.now(),
): { expiresAt: string | null, renewal: TokenRenewal, expiresSoon: boolean } {
  const left = secondsUntil(identity.token_expires_at, nowMs)
  if (left === null) return { expiresAt: null, renewal: 'none', expiresSoon: false }

  // Threads renews the access token itself; X and LinkedIn need a refresh token.
  const automatic = identity.provider === 'threads'
    || ((identity.provider === 'twitter' || identity.provider === 'linkedin') && Boolean(identity.refresh_token))

  const expiresAt = `${String(identity.token_expires_at).replace(' ', 'T')}Z`
  if (automatic) {
    // A renewed token never gets this close. If it has, renewing is failing.
    const overdue = identity.provider !== 'twitter' && left <= refreshWindow(identity.provider) / 2
    return { expiresAt, renewal: 'automatic', expiresSoon: overdue }
  }

  return { expiresAt, renewal: 'reconnect', expiresSoon: left <= EXPIRY_WARNING_SECONDS }
}
