import process from 'node:process'
import { db } from '@stacksjs/database'
import { isValidTimeZone, systemTimeZone } from '../../Support/time'

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

export function uuid(): string {
  return crypto.randomUUID()
}

/**
 * Postline is currently single-account. Return the existing account id, or
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
    // Neutral until the owner sets them in Settings. The zone is this
    // machine's, which for a self-hosted app is almost always the owner's.
    name: 'Workspace owner',
    workspace_name: 'Postline',
    timezone: isValidTimeZone(process.env.TZ) ? String(process.env.TZ) : systemTimeZone(),
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
