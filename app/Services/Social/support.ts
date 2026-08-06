import { db } from '@stacksjs/database'

const database = db as any

/** SQLite-friendly `YYYY-MM-DD HH:MM:SS` timestamp. */
export function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * A SQLite `YYYY-MM-DD HH:MM:SS` (UTC) timestamp `secondsFromNow` in the
 * future — used to record when an OAuth access token will expire. Returns null
 * when the provider didn't report a lifetime, so callers can store NULL.
 */
export function expiresAt(secondsFromNow: number | null | undefined): string | null {
  if (!secondsFromNow || secondsFromNow <= 0) return null
  return new Date(Date.now() + secondsFromNow * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Whether a stored `token_expires_at` (SQLite `YYYY-MM-DD HH:MM:SS`, UTC) is
 * already past or falls within `withinSeconds` of now — the trigger for a
 * proactive token refresh before publishing. Unknown/blank/unparseable expiry
 * returns false: there's nothing to refresh against, so leave the token alone.
 */
export function isExpiringSoon(value: string | null | undefined, withinSeconds = 7 * 24 * 60 * 60): boolean {
  if (!value) return false
  const expiry = Date.parse(`${String(value).replace(' ', 'T')}Z`)
  if (Number.isNaN(expiry)) return false
  return expiry - Date.now() <= withinSeconds * 1000
}

export function uuid(): string {
  return crypto.randomUUID()
}

/**
 * The Open Times is currently single-account. Return the existing account id, or
 * create the default workspace on first use. Shared by every social service
 * so a crosspost groups all of its targets under one account/post.
 */
export async function ensureAccount(): Promise<number> {
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
