import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { backupDatabase, databaseVersion, managesOwnTransaction, migrate, pendingMigrations, prepareData as prepareWorkspace, schemaVersion } from '../../app/Desktop/data'
import { WORKSPACE_KEY_ID_FILE, WORKSPACE_KEY_SERVICE, workspaceKey } from '../../app/Desktop/keychain'
import { testKeychain } from '../support/workspace-keychain'

/**
 * The desktop app keeps a person's queue, their connected accounts and the key
 * that encrypts their access tokens. These pin what happens
 * to that directory on a first launch and on an upgrade, which are the two
 * moments a mistake costs somebody their data.
 */
const FIRST = { '0001-create-notes.sql': 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);' }
const SECOND = { ...FIRST, '0002-add-pinned.sql': 'ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;' }

let dir = ''
let template = ''
let keychain = testKeychain()
const legacyKey = `base64:${Buffer.alloc(32, 9).toString('base64')}`

function prepareData(options: Parameters<typeof prepareWorkspace>[0]): ReturnType<typeof prepareWorkspace> {
  return prepareWorkspace({ keychain, ...options })
}
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
  keychain = testKeychain()
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
  test('is stored in Keychain and survives reopening the workspace', async () => {
    const first = await workspaceKey(dir, true, keychain)
    first.complete()
    const name = readFileSync(join(dir, WORKSPACE_KEY_ID_FILE), 'utf8').trim()

    expect(first.value).toStartWith('base64:')
    expect(Buffer.from(first.value.slice(7), 'base64')).toHaveLength(32)
    expect(await keychain.get({ service: WORKSPACE_KEY_SERVICE, name })).toBe(first.value)
    expect(existsSync(join(dir, 'app.key'))).toBe(false)
    expect((await workspaceKey(dir, false, keychain)).value).toBe(first.value)
  })

  test('restores a copied workspace only with its matching key', async () => {
    const original = await workspaceKey(dir, true, keychain)
    original.complete()
    const destination = testKeychain()
    await expect(workspaceKey(dir, false, destination)).rejects.toThrow(/original workspace key/)

    const legacy = join(dir, 'app.key')
    writeFileSync(legacy, legacyKey)
    await expect(workspaceKey(dir, false, destination)).rejects.toThrow(/does not match/)
    writeFileSync(legacy, original.value)
    const restored = await workspaceKey(dir, false, destination)
    restored.complete()
    expect(restored.value).toBe(original.value)
    expect(existsSync(legacy)).toBe(false)
  })

  test('keeps the legacy key if Keychain cannot store it', async () => {
    const legacy = join(dir, 'app.key')
    writeFileSync(legacy, legacyKey)
    const unavailable = { ...keychain, async set() { throw new Error('Keychain unavailable') } }

    await expect(workspaceKey(dir, false, unavailable)).rejects.toThrow(/Keychain unavailable/)
    expect(readFileSync(legacy, 'utf8')).toBe(legacyKey)
    expect(existsSync(join(dir, WORKSPACE_KEY_ID_FILE))).toBe(false)
  })

  test('concurrent first launches select the same workspace key', async () => {
    const [first, second] = await Promise.all([workspaceKey(dir, true, keychain), workspaceKey(dir, true, keychain)])
    expect(first.value).toBe(second.value)
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
  test('a first launch starts from the built database', async () => {
    const data = join(dir, 'data')
    const prepared = await prepareData({ dataDir: data, template, migrations: FIRST, origin: 'http://127.0.0.1:4100' })

    expect(prepared.created).toBe(true)
    expect(prepared.applied).toEqual([])
    expect(statSync(prepared.databasePath).mode & 0o777).toBe(0o600)
    expect(pendingMigrations(prepared.databasePath, FIRST)).toEqual([])
  })

  test('points the process at the data directory before anything else loads', async () => {
    const data = join(dir, 'data')
    const prepared = await prepareData({ dataDir: data, template, migrations: FIRST, origin: 'http://127.0.0.1:4100' })

    // Uploaded media and blog posts are kept relative to the working directory.
    const name = readFileSync(join(process.cwd(), WORKSPACE_KEY_ID_FILE), 'utf8').trim()
    expect(await keychain.get({ service: WORKSPACE_KEY_SERVICE, name })).toBe(String(process.env.APP_KEY))
    expect(process.env.DB_CONNECTION).toBe('sqlite')
    expect(process.env.DB_DATABASE_PATH).toBe(prepared.databasePath)
    expect(process.env.POSTLINE_DESKTOP_AGENT).toBe('1')
    expect(process.env.APP_URL).toBe('http://127.0.0.1:4100')
  })

  test('an upgrade migrates the existing database and keeps what is in it', async () => {
    const data = join(dir, 'data')
    const first = await prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)

    const before = new Database(first.databasePath)
    before.run('INSERT INTO notes (body) VALUES (?)', ['queued for Friday'])
    before.close()

    const upgraded = await prepareData({ dataDir: data, template, migrations: SECOND })

    expect(upgraded.created).toBe(false)
    expect(upgraded.applied).toEqual(['0002-add-pinned.sql'])

    const after = new Database(upgraded.databasePath, { readonly: true })
    expect(after.query('SELECT body, pinned FROM notes').all()).toEqual([{ body: 'queued for Friday', pinned: 0 }])
    after.close()
  })

  test('an upgrade copies the database aside first', async () => {
    const data = join(dir, 'data')
    await prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)
    await prepareData({ dataDir: data, template, migrations: SECOND })

    expect(readdirSync(data)).toContain('postline.before-0002-add-pinned.sqlite')
  })

  test('a launch with nothing to migrate copies nothing', async () => {
    const data = join(dir, 'data')
    await prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)
    const again = await prepareData({ dataDir: data, template, migrations: FIRST })

    expect(again.applied).toEqual([])
    expect(readdirSync(data).filter(name => name.includes('before-'))).toEqual([])
    expect(existsSync(again.databasePath)).toBe(true)
  })
})

/**
 * A table rebuild, shaped the way the framework's generator writes one: it
 * turns foreign keys off and opens its own transaction. This is the kind of
 * migration the app could not apply at all.
 */
const REBUILD = `-- qb:generated
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_notes" (
  "id" INTEGER PRIMARY KEY,
  "body" TEXT NOT NULL,
  "kind" TEXT CHECK ("kind" IN ('note', 'draft')) not null default 'note'
);
INSERT INTO "_qb_tmp_notes" ("id", "body") SELECT "id", "body" FROM "notes";
DROP TABLE "notes";
ALTER TABLE "_qb_tmp_notes" RENAME TO "notes";
COMMIT;
PRAGMA foreign_keys=ON;`

const THIRD = { ...FIRST, '0003-rebuild-notes.sql': REBUILD }

describe('a migration that manages its own transaction', () => {
  test('is recognised, whatever comments surround it', () => {
    expect(managesOwnTransaction(REBUILD)).toBe(true)
    expect(managesOwnTransaction('-- BEGIN; only in a comment\nALTER TABLE notes ADD COLUMN x INTEGER;')).toBe(false)
    expect(managesOwnTransaction(FIRST['0001-create-notes.sql'])).toBe(false)
  })

  test('is applied, and keeps the rows it moves', () => {
    const file = join(dir, 'rebuild.sqlite')
    migrate(file, FIRST)
    const before = new Database(file)
    before.run('INSERT INTO notes (body) VALUES (?)', ['queued for Friday'])
    before.close()

    expect(migrate(file, THIRD)).toEqual(['0003-rebuild-notes.sql'])

    const after = new Database(file, { readonly: true })
    expect(after.query('SELECT body, kind FROM notes').all()).toEqual([{ body: 'queued for Friday', kind: 'note' }])
    after.close()
    expect(pendingMigrations(file, THIRD)).toEqual([])
  })

  test('that fails halfway leaves the table as it was and no record', () => {
    const file = join(dir, 'rebuild-broken.sqlite')
    migrate(file, FIRST)
    const seed = new Database(file)
    seed.run('INSERT INTO notes (body) VALUES (?)', ['still here'])
    seed.close()
    const broken = { ...FIRST, '0003-broken-rebuild.sql': REBUILD.replace('DROP TABLE "notes";', 'DROP TABLE "notes"; INSERT INTO missing VALUES (1);') }

    expect(() => migrate(file, broken)).toThrow(/0003-broken-rebuild/)

    const after = new Database(file, { readonly: true })
    expect(after.query('SELECT body FROM notes').all()).toEqual([{ body: 'still here' }])
    after.close()
    expect(pendingMigrations(file, broken)).toEqual(['0003-broken-rebuild.sql'])
  })

  test('leaves foreign keys on for whatever runs next', () => {
    const file = join(dir, 'rebuild-fk.sqlite')
    migrate(file, THIRD)

    // A fresh connection is how the app opens it; the setting is per
    // connection, so this asserts the file is sound, not the pragma.
    const database = new Database(file, { readonly: true })
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()
  })
})

describe('every migration the app ships', () => {
  test('can be applied by the app itself, in order, to an empty database', async () => {
    const folder = join(cwd, 'database/migrations')
    const real: Record<string, string> = {}
    for (const name of readdirSync(folder).filter(file => file.endsWith('.sql')).sort())
      real[name] = readFileSync(join(folder, name), 'utf8')

    const file = join(dir, 'real.sqlite')
    const applied = migrate(file, real)

    expect(applied).toEqual(Object.keys(real).sort())
    expect(Object.values(real).some(managesOwnTransaction)).toBe(true)

    const database = new Database(file, { readonly: true })
    const tables = (database.query('SELECT name FROM sqlite_master WHERE type = \'table\'').all() as Array<{ name: string }>).map(row => row.name)
    database.close()
    for (const table of ['posts', 'post_targets', 'social_identities', 'purge_runs'])
      expect(tables).toContain(table)
    expect(databaseVersion(file)).toBe(schemaVersion(real))
  })
})

describe('the copy made before an upgrade', () => {
  test('includes writes that are still only in the write-ahead log', () => {
    const file = join(dir, 'wal.sqlite')
    migrate(file, FIRST)
    // Left open, so nothing is checkpointed into the main file.
    const writer = new Database(file)
    writer.exec('PRAGMA journal_mode = WAL')
    writer.exec('PRAGMA wal_autocheckpoint = 0')
    writer.run('INSERT INTO notes (body) VALUES (?)', ['written a moment ago'])

    const copy = join(dir, 'wal-copy.sqlite')
    backupDatabase(file, copy)
    writer.close()

    const restored = new Database(copy, { readonly: true })
    expect(restored.query('SELECT body FROM notes').all()).toEqual([{ body: 'written a moment ago' }])
    restored.close()
    expect(statSync(copy).mode & 0o777).toBe(0o600)
  })
})

describe('an upgrade that goes wrong', () => {
  test('puts the database back exactly as it was', async () => {
    const data = join(dir, 'data')
    const first = await prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)
    const seed = new Database(first.databasePath)
    seed.run('INSERT INTO notes (body) VALUES (?)', ['must survive'])
    seed.close()

    const broken = {
      ...FIRST,
      '0002-add-pinned.sql': SECOND['0002-add-pinned.sql'],
      '0003-broken.sql': 'INSERT INTO missing VALUES (1);',
    }
    // Simulate the legacy key still present when a pre-Keychain app is upgraded.
    writeFileSync(join(data, 'app.key'), String(process.env.APP_KEY))
    await expect(prepareData({ dataDir: data, template, migrations: broken })).rejects.toThrow(/put it back as it was/)
    expect(readFileSync(join(data, 'app.key'), 'utf8')).toBe(String(process.env.APP_KEY))
    process.chdir(cwd)

    // Not even the migration that succeeded before the failure is kept: the
    // previous version of the app has to be able to open this again.
    const after = new Database(first.databasePath, { readonly: true })
    const columns = (after.query('PRAGMA table_info(notes)').all() as Array<{ name: string }>).map(column => column.name)
    expect(columns).toEqual(['id', 'body'])
    expect(after.query('SELECT body FROM notes').all()).toEqual([{ body: 'must survive' }])
    after.close()
    expect(pendingMigrations(first.databasePath, broken)).toEqual(['0002-add-pinned.sql', '0003-broken.sql'])
  })
})

describe('opening data from a newer version', () => {
  test('is refused, and nothing is changed', async () => {
    const data = join(dir, 'data')
    const newer = { ...SECOND, '0009-from-the-future.sql': 'CREATE TABLE later (id INTEGER PRIMARY KEY);' }
    await prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)
    await prepareData({ dataDir: data, template, migrations: newer })
    process.chdir(cwd)

    await expect(prepareData({ dataDir: data, template, migrations: SECOND })).rejects.toThrow(/newer version of Postline/)
    process.chdir(cwd)

    const database = new Database(join(data, 'postline.sqlite'), { readonly: true })
    const tables = (database.query('SELECT name FROM sqlite_master WHERE type = \'table\'').all() as Array<{ name: string }>).map(row => row.name)
    database.close()
    expect(tables).toContain('later')
  })

  test('a database made before versions were recorded still opens', async () => {
    const data = join(dir, 'data')
    const first = await prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)
    const database = new Database(first.databasePath)
    database.exec('PRAGMA user_version = 0')
    database.close()

    await expect(prepareData({ dataDir: data, template, migrations: FIRST })).resolves.toMatchObject({ created: false })
    process.chdir(cwd)
    expect(databaseVersion(first.databasePath)).toBe(schemaVersion(FIRST))
  })
})

describe('old pre-upgrade copies', () => {
  test('are pruned to the newest three', async () => {
    const data = join(dir, 'data')
    await prepareData({ dataDir: data, template, migrations: FIRST })
    process.chdir(cwd)
    let migrations: Record<string, string> = { ...FIRST }
    for (let step = 2; step <= 6; step++) {
      migrations = { ...migrations, [`000${step}-step.sql`]: `CREATE TABLE step_${step} (id INTEGER PRIMARY KEY);` }
      await prepareData({ dataDir: data, template, migrations })
      process.chdir(cwd)
    }

    const copies = readdirSync(data).filter(name => name.startsWith('postline.before-')).sort()
    expect(copies).toEqual(['postline.before-0004-step.sqlite', 'postline.before-0005-step.sqlite', 'postline.before-0006-step.sqlite'])
  })
})
