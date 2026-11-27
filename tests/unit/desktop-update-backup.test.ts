import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createDesktopUpdater, generateUpdateKeypair, signUpdateManifest } from '@stacksjs/desktop-build'
import agent from '../../app/Desktop/Agent'

let directory: string
let databasePath: string
let previousDatabase: string | undefined

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'postline-desktop-update-'))
  databasePath = join(directory, 'postline.sqlite')
  previousDatabase = process.env.DB_DATABASE_PATH
  process.env.DB_DATABASE_PATH = databasePath
})

afterEach(() => {
  if (previousDatabase === undefined) delete process.env.DB_DATABASE_PATH
  else process.env.DB_DATABASE_PATH = previousDatabase
  rmSync(directory, { recursive: true, force: true })
})

function signedUpdate(inspectWorkspace = () => {}) {
  const artifact = 'Postline update fixture'
  const url = 'https://updates.example.test/postline.zip'
  const keys = generateUpdateKeypair('main')
  const manifest = signUpdateManifest({
    version: '0.4.1',
    url,
    sha256: createHash('sha256').update(artifact).digest('hex'),
    size: Buffer.byteLength(artifact),
    platform: 'darwin',
    architecture: 'arm64',
    sourceRevision: 'a'.repeat(40),
    publishedAt: '2026-11-11T00:00:00.000Z',
  }, keys.privateKey, keys.keyId)

  const installed = mock(() => {
    inspectWorkspace()
    return { status: 'installed' as const, relaunch() {} }
  })
  const updater = createDesktopUpdater({
    currentVersion: '0.4.0',
    feedUrl: 'https://updates.example.test/api/updates',
    trustedKeys: { [keys.keyId]: keys.publicKey },
    updatesDir: join(directory, 'staged'),
    beforeInstall: agent.beforeInstall,
    target: { platform: 'darwin', architecture: 'arm64' },
    installation: { kind: 'macos-bundle', path: join(directory, 'Postline.app'), executable: join(directory, 'Postline.app/Contents/MacOS/Postline') },
    fetcher: async input => String(input) === url ? new Response(artifact) : Response.json(manifest),
    install: installed,
  })
  return { updater, installed }
}

test('an in-app update saves recent writes before handing the artifact to the installer', async () => {
  using writer = new Database(databasePath)
  writer.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE drafts (body TEXT);')
  writer.run('INSERT INTO drafts VALUES (?)', ['Ready on Friday'])

  const backups = join(directory, 'update-backups')
  mkdirSync(backups, { mode: 0o700 })
  const earlier = [1, 2, 3].map(day => `postline.before-update-2025-01-0${day}T01-00-00.000Z.sqlite`)
  for (const filename of earlier) writeFileSync(join(backups, filename), 'older fixture', { mode: 0o600 })
  writeFileSync(join(backups, 'operator-copy.sqlite'), 'keep this copy')
  const { updater, installed } = signedUpdate(() => {
    const names = readdirSync(backups).sort()
    const newName = names.at(-1)!
    expect(names).toEqual(['operator-copy.sqlite', ...earlier.slice(1), newName])
    expect(newName).toMatch(/^postline\.before-update-.*\.sqlite$/)
    expect(statSync(join(backups, newName)).mode & 0o777).toBe(0o600)
    using backup = new Database(join(backups, newName), { readonly: true })
    expect(backup.query('SELECT body FROM drafts').all()).toEqual([{ body: 'Ready on Friday' }])
  })

  expect(await updater.check()).toMatchObject({ state: 'available', version: '0.4.1' })
  expect(readdirSync(backups).sort()).toEqual(['operator-copy.sqlite', ...earlier])
  expect(await updater.install()).toMatchObject({ state: 'installed' })
  expect(installed).toHaveBeenCalledTimes(1)
})

test('a backup failure leaves the installed version in place', async () => {
  using writer = new Database(databasePath)
  writer.exec('CREATE TABLE drafts (body TEXT)')
  writeFileSync(join(directory, 'update-backups'), 'must be a directory')
  const { updater, installed } = signedUpdate()

  expect(await updater.check()).toMatchObject({ state: 'available' })
  expect(await updater.install()).toMatchObject({
    state: 'error',
    error: expect.stringContaining('could not back up its workspace database'),
    currentVersion: '0.4.0',
  })
  expect(installed).not.toHaveBeenCalled()
})
