import { db, sqliteWriteOptions } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { uuid } from './support'

const database = db as any

export interface SocialOperationLease {
  renew: () => boolean
  release: () => void
}

function timestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, -1)
}

/** API and Scheduler take a lease in the same workspace database. */
export function acquireSocialOperationLease(key: string, ttlMs: number, clock = Date.now): SocialOperationLease | null {
  const token = uuid()
  const claimed = database.transaction((tx: typeof database) => {
    const at = clock()
    const now = timestamp(at)
    tx.deleteFrom('social_operation_leases').where('lease_key', '=', key).where('expires_at', '<=', now).execute()
    if (tx.selectFrom('social_operation_leases').select('id').where('lease_key', '=', key).executeTakeFirst()) return false
    tx.insertInto('social_operation_leases').values({
      lease_key: key, uuid: token, expires_at: timestamp(at + ttlMs), created_at: now, updated_at: now,
    }).execute()
    return true
  }, sqliteWriteOptions())
  if (!claimed) return null

  return {
    renew() {
      const at = clock()
      const now = timestamp(at)
      try {
        return Boolean(database.updateTable('social_operation_leases')
          .set({ expires_at: timestamp(at + ttlMs), updated_at: now })
          .where('lease_key', '=', key).where('uuid', '=', token).where('expires_at', '>', now)
          .returning('id').executeTakeFirst())
      }
      catch {
        log.warn('[postline] The social operation lease could not be renewed.')
        return false
      }
    },
    release() {
      try {
        database.deleteFrom('social_operation_leases').where('lease_key', '=', key).where('uuid', '=', token).execute()
      }
      catch {
        log.warn('[postline] The social operation lease could not be released. It will expire.')
      }
    },
  }
}
