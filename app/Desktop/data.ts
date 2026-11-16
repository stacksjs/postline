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
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
 * Bring a database up to the schema this version of the app was built with.
 *
 * `migrations` is every migration the build's own database was made from, by
 * file name. The ledger is the framework's own table, so a database made here
 * is one `buddy migrate` would recognise. Each file is applied with its ledger
 * row in one transaction: a migration that fails leaves no half of itself and
 * no row claiming it ran.
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

      database.transaction(() => {
        database.exec(migrations[name]!)
        record.run(name)
      })()
      applied.push(name)
    }
  }
  finally {
    database.close()
  }

  return applied
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
    const pending = pendingMigrations(databasePath, options.migrations)
    if (pending.length > 0) {
      copyFileSync(databasePath, join(dataDir, `postline.before-${pending[0]!.replace(/\.sql$/, '')}.sqlite`))
      applied = migrate(databasePath, options.migrations)
    }
  }

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
