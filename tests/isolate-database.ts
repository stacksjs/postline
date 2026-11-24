/**
 * Give the suite a database of its own.
 *
 * Preloaded before `tests/setup.ts` and before any `@stacksjs/*` module is
 * evaluated, because the database path is read from the environment when
 * config loads. It only uses Node built-ins for the same reason.
 *
 * Without this the suite ran against whatever `DB_DATABASE_PATH` the local
 * `.env` named, which on a developer's machine is their real workspace: it
 * added purge runs, a default account and, on an empty database, a user,
 * which also closes first-run registration.
 *
 * Migrating takes a few seconds, so a migrated template is cached under
 * `storage/framework/cache/` and keyed on the migration files. Each run works
 * on a fresh copy in the system temp directory and removes it on exit.
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dir, '..')
const migrationsDir = join(root, 'database', 'migrations')
const cacheDir = join(root, 'storage', 'framework', 'cache', 'test-database')

function migrationsFingerprint(): string {
  const hash = createHash('sha256')
  for (const name of readdirSync(migrationsDir).sort()) {
    const stat = statSync(join(migrationsDir, name))
    hash.update(`${name}:${stat.size}:${stat.mtimeMs}\n`)
  }
  return hash.digest('hex').slice(0, 16)
}

function buildTemplate(template: string): void {
  mkdirSync(cacheDir, { recursive: true })
  const building = `${template}.building-${process.pid}`
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(`${building}${suffix}`, { force: true })

  const result = spawnSync(process.execPath, [join(root, 'node_modules/@stacksjs/buddy/dist/cli.js'), 'migrate'], {
    cwd: root,
    env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE_PATH: building },
    encoding: 'utf8',
  })
  if (result.status !== 0 || !existsSync(building)) {
    throw new Error(`Could not migrate a test database.\n${result.stdout || ''}\n${result.stderr || ''}`)
  }

  // Fold the write-ahead log into the main file so one copy is the whole database.
  spawnSync('sqlite3', [building, 'PRAGMA wal_checkpoint(TRUNCATE);'], { encoding: 'utf8' })
  copyFileSync(building, template)
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(`${building}${suffix}`, { force: true })
}

const template = join(cacheDir, `${migrationsFingerprint()}.sqlite`)
if (!existsSync(template))
  buildTemplate(template)

const database = join(tmpdir(), `postline-test-${process.pid}-${Date.now()}.sqlite`)
copyFileSync(template, database)

process.env.DB_CONNECTION = 'sqlite'
process.env.DB_DATABASE_PATH = database
process.env.POSTLINE_TEST_DATABASE = database
// Publishing to the blog writes Markdown files; keep them out of the project.
const blogDir = join(tmpdir(), `postline-test-blog-${process.pid}-${Date.now()}`)
process.env.POSTLINE_BLOG_DIR = blogDir
// Stacks' `bootTestEnvironment()` (called from tests/setup.ts) makes an empty
// throwaway database of its own unless told one is already configured. This
// one is, and is migrated, so it keeps it. The path also tells the framework's
// reset helpers that this file belongs to the test run.
process.env.STACKS_TEST_DATABASE = 'configured'
process.env.STACKS_TEST_DATABASE_PATH = database

// Network tokens are sealed with the app key. A CI runner has no `.env`, so
// the suite gets a throwaway key of its own when none is set.
if (!process.env.APP_KEY)
  process.env.APP_KEY = `base64:${randomBytes(32).toString('base64')}`

process.on('exit', () => {
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(`${database}${suffix}`, { force: true })
  rmSync(blogDir, { recursive: true, force: true })
})
