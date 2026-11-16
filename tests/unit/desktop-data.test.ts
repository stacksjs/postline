import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { appKey, migrate, pendingMigrations, prepareData } from '../../app/Desktop/data'

/**
 * The desktop app keeps a person's queue, their connected accounts and the key
 * that encrypts their access tokens in one directory. These pin what happens
 * to that directory on a first launch and on an upgrade, which are the two
 * moments a mistake costs somebody their data.
 */
const FIRST = { '0001-create-notes.sql': 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);' }
const SECOND = { ...FIRST, '0002-add-pinned.sql': 'ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;' }

let dir = ''
let template = ''
const cwd = process.cwd()
const env = { ...process.env }

/** A database as the build makes it: migrated, and empty. */
function buildTemplate(migrations: Record<string, string>): string {
  const file = join(dir, 'template.sqlite')
  migrate(file, migrations)
  const database = new Database(file)
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  database.exec('PRAGMA journal_mode = DELETE')
  database.close()
  return file
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postline-desktop-'))
  template = buildTemplate(FIRST)
})

afterEach(() => {
  process.chdir(cwd)
  for (const key of Object.keys(process.env)) {
    if (!(key in env)) delete process.env[key]
  }
  Object.assign(process.env, env)
  rmSync(dir, { recursive: true, force: true })
})

describe('the app key', () => {
  test('is made once, kept private, and read back the same', () => {
    const first = appKey(dir)

    expect(first).toStartWith('base64:')
    expect(Buffer.from(first.slice(7), 'base64')).toHaveLength(32)
    expect(statSync(join(dir, 'app.key')).mode & 0o777).toBe(0o600)
    // A key that changed between launches would leave every stored access
    // token unreadable.
    expect(appKey(dir)).toBe(first)
  })
})

describe('migrating', () => {
  test('applies each migration once and records it', () => {
    const file = join(dir, 'fresh.sqlite')

    expect(migrate(file, SECOND)).toEqual(['0001-create-notes.sql', '0002-add-pinned.sql'])
    expect(migrate(file, SECOND)).toEqual([])
    expect(pendingMigrations(file, SECOND)).toEqual([])
  })

  test('a migration that fails leaves no half of itself and no record', () => {
    const file = join(dir, 'broken.sqlite')
    const broken = { ...FIRST, '0002-broken.sql': 'CREATE TABLE extra (id INTEGER); INSERT INTO missing VALUES (1);' }

    expect(() => migrate(file, broken)).toThrow()

    const database = new Database(file, { readonly: true })
    const tables = (database.query('SELECT name FROM sqlite_master WHERE type = \'table\'').all() as Array<{ name: string }>).map(row => row.name)
    database.close()

    expect(tables).toContain('notes')
    expect(tables).not.toContain('extra')
    expect(pendingMigrations(file, broken)).toEqual(['0002-broken.sql'])
  })
})

describe('preparing the data directory', () => {
  test('a first launch starts from the built database', () => {
    const data = join(dir, 'data')
    const prepared = prepareData({ dataDir: data, template, migrations: FIRST, origin: 'http://127.0.0.1:4100' })

    expect(prepared.created).toBe(true)
    expect(prepared.applied).toEqual([])
    expect(statSync(prepared.databasePath).mode & 0o777).toBe(0o600)
    expect(pendingMigrations(prepared.databasePath, FIRST)).toEqual([])
  })

  test('points the process at the data directory before anything else loads', () => {
    const data = join(dir, 'data')
    const prepared = prepareData({ dataDir: data, template, migrations: FIRST, origin: 'http://127.0.0.1:4100' })

    // Uploaded media and blog posts are kept relative to the working directory.
    expect(readFileSync(join(process.cwd(), 'app.key'), 'utf8').trim()).toBe(String(process.env.APP_KEY))
    expect(process.env.DB_CONNECTION).toBe('sqlite')
    expect(process.env.DB_DATABASE_PATH).toBe(prepared.databasePath)
    expect(process.env.POSTLINE_DESKTOP_AGENT).toBe('1')
    expect(process.env.APP_URL).toBe('http://127.0.0.1:4100')
  })

  test('an upgrade migrates the existing database and keeps what is in it', () => {
    const data = join(dir, 'data')
    const first = prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)

    const before = new Database(first.databasePath)
    before.run('INSERT INTO notes (body) VALUES (?)', ['queued for Friday'])
    before.close()

    const upgraded = prepareData({ dataDir: data, template, migrations: SECOND })

    expect(upgraded.created).toBe(false)
    expect(upgraded.applied).toEqual(['0002-add-pinned.sql'])

    const after = new Database(upgraded.databasePath, { readonly: true })
    expect(after.query('SELECT body, pinned FROM notes').all()).toEqual([{ body: 'queued for Friday', pinned: 0 }])
    after.close()
  })

  test('an upgrade copies the database aside first', () => {
    const data = join(dir, 'data')
    prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)
    prepareData({ dataDir: data, template, migrations: SECOND })

    expect(readdirSync(data)).toContain('postline.before-0002-add-pinned.sqlite')
  })

  test('a launch with nothing to migrate copies nothing', () => {
    const data = join(dir, 'data')
    prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)
    const again = prepareData({ dataDir: data, template, migrations: FIRST })

    expect(again.applied).toEqual([])
    expect(readdirSync(data).filter(name => name.includes('before-'))).toEqual([])
    expect(existsSync(again.databasePath)).toBe(true)
  })
})
