import { statfsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { pendingMigrationFiles } from '@stacksjs/database'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { readHeartbeats, schedulerState } from '../../Support/heartbeat'

/** A scheduler that has never run is given this long after the server starts. */
const STARTUP_GRACE_SECONDS = 180

/** Below this much free space where the database lives, writes are about to fail. */
export const LOW_DISK_BYTES = 512 * 1024 * 1024

/** Free bytes on the disk holding the database, or null when it cannot be read. */
export function freeBytes(path: string = process.env.DB_DATABASE_PATH || 'database/postline.sqlite'): number | null {
  try {
    const folder = dirname(isAbsolute(path) ? path : resolve(process.cwd(), path))
    const stats = statfsSync(folder)
    return Number(stats.bavail) * Number(stats.bsize)
  }
  catch {
    return null
  }
}

// Reading the migration files on every probe would be wasteful; a minute of
// memory is enough for a check that matters after a deploy.
let migrationsChecked: { pending: boolean, at: number } | null = null
async function migrationsPending(): Promise<boolean> {
  if (migrationsChecked && Date.now() - migrationsChecked.at < 60_000) return migrationsChecked.pending
  const pending = (await pendingMigrationFiles()).length > 0
  migrationsChecked = { pending, at: Date.now() }
  return pending
}

/**
 * A health check that knows about the scheduler. The framework's own check
 * looks at the database and the cache; with only that, a workspace whose
 * scheduler has died reports healthy while every scheduled post sits unsent.
 *
 * Public, because a load balancer or uptime monitor calls it without a
 * session. It says nothing about the workspace beyond these states.
 */
export default new Action({
  name: 'Postline Health',
  description: 'Reports whether the database is reachable, the scheduler is running, the disk has room and the schema is migrated.',
  method: 'GET',

  async handle() {
    try {
      const { state } = schedulerState(await readHeartbeats())
      const starting = state === 'never' && process.uptime() < STARTUP_GRACE_SECONDS
      const free = freeBytes()
      const disk = free === null ? 'unknown' : free < LOW_DISK_BYTES ? 'low' : 'ok'
      // A deploy that did not migrate serves code the schema does not match.
      const migrations = await migrationsPending().catch(() => false) ? 'pending' : 'ok'
      const healthy = (state === 'ok' || starting) && disk !== 'low' && migrations === 'ok'
      return response.json({ ok: healthy, database: 'ok', scheduler: starting ? 'starting' : state, disk, migrations }, { status: healthy ? 200 : 503 })
    }
    catch {
      return response.json({ ok: false, database: 'unreachable', scheduler: 'unknown', disk: 'unknown', migrations: 'unknown' }, { status: 503 })
    }
  },
})
