/**
 * Where the desktop app keeps what is the user's: the database, the key that
 * encrypts their access tokens, and uploaded media.
 *
 * Everything here runs before a single framework module is loaded, and
 * imports nothing but Node. That order is the point: the framework reads the
 * database path and the app key from the environment when its modules are
 * first evaluated, and the app's own code fixes its media and blog directories
 * from the working directory at the same moment. Setting them afterwards
 * changes nothing.
 */
import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

export interface PreparedData {
  databasePath: string
  /** Migrations applied on this launch, by file name. Empty on most launches. */
  applied: string[]
  /** True when this launch created the database. */
  created: boolean
}

/**
 * The app key, made once and kept. It encrypts the access tokens in the
 * database, so losing it means reconnecting every account, and so it lives
 * beside the database it unlocks and nowhere else.
 */
export function appKey(dataDir: string): string {
  const file = join(dataDir, 'app.key')
  if (existsSync(file)) {
    const key = readFileSync(file, 'utf8').trim()
    if (key) return key
  }

  const key = `base64:${randomBytes(32).toString('base64')}`
  writeFileSync(file, `${key}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)

  return key
}

/**
 * Whether a migration opens its own transaction.
 *
 * SQLite cannot alter a CHECK constraint or drop most columns in place, so the
 * framework's generator rebuilds the table instead: foreign keys off, BEGIN,
 * copy into a new table, swap, COMMIT. Such a file has to run as it is.
 * Wrapping it in a second transaction fails outright ("cannot start a
 * transaction within a transaction"), and `PRAGMA foreign_keys` does nothing
 * inside one.
 */
export function managesOwnTransaction(sql: string): boolean {
  const withoutComments = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  return /(?:^|;)\s*BEGIN\b/i.test(withoutComments)
}

/** The number a migration file name starts with, or 0. */
function migrationNumber(name: string): number {
  return Number(name.match(/^(\d+)/)?.[1] ?? 0)
}

/** The schema version a set of migrations brings a database to. */
export function schemaVersion(migrations: Record<string, string>): number {
  return Object.keys(migrations).reduce((highest, name) => Math.max(highest, migrationNumber(name)), 0)
}

/**
 * Bring a database up to the schema this version of the app was built with.
 *
 * `migrations` is every migration the build's own database was made from, by
 * file name. The ledger is the framework's own table, so a database made here
 * is one `buddy migrate` would recognise.
 *
 * A file that does not manage its own transaction is applied together with
 * its ledger row in one, so a failure leaves no half of itself and no row
 * claiming it ran. A file that does (a table rebuild) is run as written and
 * its row recorded straight after; if it fails, whatever it left open is
 * rolled back.
 *
 * The first failure stops the run and is thrown. The caller holds a backup.
 */
export function migrate(databasePath: string, migrations: Record<string, string>): string[] {
  const database = new Database(databasePath)
  const applied: string[] = []

  try {
    database.exec('PRAGMA journal_mode = WAL')
    database.exec(`CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration TEXT NOT NULL UNIQUE,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)

    const done = new Set((database.query('SELECT migration FROM migrations').all() as Array<{ migration: string }>).map(row => row.migration))
    const record = database.query('INSERT INTO migrations (migration) VALUES (?)')

    for (const name of Object.keys(migrations).sort()) {
      if (done.has(name)) continue
      const sql = migrations[name]!

      try {
        if (managesOwnTransaction(sql)) {
          database.exec(sql)
          record.run(name)
        }
        else {
          database.transaction(() => {
            database.exec(sql)
            record.run(name)
          })()
        }
      }
      catch (error) {
        if (database.inTransaction)
          database.exec('ROLLBACK')
        throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      finally {
        // A rebuild turns foreign keys off for itself. Whatever it did, the
        // next statement runs with them on.
        database.exec('PRAGMA foreign_keys = ON')
      }

      applied.push(name)
    }

    // Never lowered: a build that carries fewer files than the database has
    // seen must not make it look older than it is.
    const current = Number((database.query('PRAGMA user_version').get() as { user_version: number }).user_version)
    const target = schemaVersion(migrations)
    if (target > current)
      database.exec(`PRAGMA user_version = ${target}`)
  }
  finally {
    database.close()
  }

  return applied
}

/** Record the schema version on a database that is already at it. Never lowers it. */
export function stampSchemaVersion(databasePath: string, version: number): void {
  const database = new Database(databasePath)
  try {
    const current = Number((database.query('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (version > current)
      database.exec(`PRAGMA user_version = ${Math.trunc(version)}`)
  }
  finally {
    database.close()
  }
}

/** The schema version recorded in a database, or 0 for one made before versions were recorded. */
export function databaseVersion(databasePath: string): number {
  const database = new Database(databasePath, { readonly: true })
  try {
    return Number((database.query('PRAGMA user_version').get() as { user_version: number }).user_version)
  }
  finally {
    database.close()
  }
}

/**
 * Copy a live database to `destination`, consistently.
 *
 * The database runs in WAL mode, where recent writes sit in a second file
 * until they are checkpointed. Copying only the main file can therefore miss
 * the newest posts. `VACUUM INTO` writes one complete file from what a reader
 * sees right now.
 */
export function backupDatabase(databasePath: string, destination: string): void {
  rmSync(destination, { force: true })
  const database = new Database(databasePath)
  try {
    database.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`)
  }
  finally {
    database.close()
  }
  chmodSync(destination, 0o600)
}

/** Put a backup back in place of the database, discarding its WAL files. */
function restoreDatabase(backup: string, databasePath: string): void {
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(`${databasePath}${suffix}`, { force: true })
  copyFileSync(backup, databasePath)
  chmodSync(databasePath, 0o600)
}

const BACKUPS_KEPT = 3

/** Remove all but the newest few pre-upgrade backups. */
function pruneBackups(dataDir: string): void {
  const backups = readdirSync(dataDir)
    .filter(name => /^postline\.before-.*\.sqlite$/.test(name))
    .sort()
  for (const name of backups.slice(0, Math.max(0, backups.length - BACKUPS_KEPT)))
    rmSync(join(dataDir, name), { force: true })
}

/**
 * Make the data directory ready and point the process at it.
 *
 * A first launch copies the database the build made (already migrated, and
 * empty). Every later launch applies whatever migrations a newer build
 * carries, after copying the database aside: an upgrade that goes wrong must
 * not be the only copy of somebody's queue.
 */
export function prepareData(options: {
  dataDir: string
  /** The built, migrated, empty database, as a path the process can read. */
  template: string
  migrations: Record<string, string>
  origin?: string
}): PreparedData {
  const { dataDir } = options
  mkdirSync(dataDir, { recursive: true })

  const databasePath = join(dataDir, 'postline.sqlite')
  const created = !existsSync(databasePath)

  if (created) {
    // Read and written, not copied: inside the compiled app the template is an
    // embedded file, which can be read like any other but is not a path
    // `copyFileSync` can open.
    writeFileSync(databasePath, readFileSync(options.template), { mode: 0o600 })
    chmodSync(databasePath, 0o600)
  }

  let applied: string[] = []
  if (!created) {
    // An older app must not open a database a newer one has already changed:
    // it would run against tables and columns it does not know.
    const found = databaseVersion(databasePath)
    const built = schemaVersion(options.migrations)
    if (found > built) {
      throw new Error(
        `This data was last used by a newer version of Postline (schema ${found}; this version understands ${built}). `
        + 'Install the newer version again. Nothing was changed.',
      )
    }

    const pending = pendingMigrations(databasePath, options.migrations)
    if (pending.length > 0) {
      const backup = join(dataDir, `postline.before-${pending[0]!.replace(/\.sql$/, '')}.sqlite`)
      backupDatabase(databasePath, backup)

      try {
        applied = migrate(databasePath, options.migrations)
      }
      catch (error) {
        // The upgrade did not finish. Put back exactly what was there, so the
        // previous version of the app still opens it.
        restoreDatabase(backup, databasePath)
        throw new Error(
          `Postline could not upgrade its data, and has put it back as it was. ${error instanceof Error ? error.message : String(error)} `
          + `A copy is also at ${backup}.`,
        )
      }

      pruneBackups(dataDir)
    }
  }

  // A database made from the template, or one that was already up to date
  // before versions were recorded, carries no version yet. Recording it now
  // is what lets an older app recognise this data as newer than itself.
  if (pendingMigrations(databasePath, options.migrations).length === 0)
    stampSchemaVersion(databasePath, schemaVersion(options.migrations))

  // The working directory is where the app's own code keeps uploaded media
  // (`storage/app/postline-media`) and blog posts (`content/blog`). Launched
  // from Finder it would otherwise be `/`.
  process.chdir(dataDir)

  Object.assign(process.env, {
    APP_NAME: 'Postline',
    APP_ENV: 'production',
    APP_KEY: appKey(dataDir),
    DB_CONNECTION: 'sqlite',
    DB_DATABASE_PATH: databasePath,
    // What tells the auth middleware the caller is the app's own window. See
    // app/Support/Auth/native.ts.
    POSTLINE_DESKTOP_AGENT: '1',
    ...(options.origin ? { APP_URL: options.origin } : {}),
  })

  return { databasePath, applied, created }
}

/** The migrations a build carries that this database has not had. */
export function pendingMigrations(databasePath: string, migrations: Record<string, string>): string[] {
  const database = new Database(databasePath, { readonly: true })
  try {
    const done = new Set((database.query('SELECT migration FROM migrations').all() as Array<{ migration: string }>).map(row => row.migration))
    return Object.keys(migrations).sort().filter(name => !done.has(name))
  }
  catch {
    // No ledger at all: not a database this app made. Apply everything.
    return Object.keys(migrations).sort()
  }
  finally {
    database.close()
  }
}
