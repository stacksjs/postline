import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquirePurgeLock, PURGE_LOCK_STALE_MS, purgeLockPath } from '../../app/Support/Social/purge-lock'

let dir = ''
let path = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postline-purge-lock-'))
  path = join(dir, 'postline-purge.lock')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the deletion lock', () => {
  test('is held by one run at a time', () => {
    const release = acquirePurgeLock(path)

    expect(release).not.toBeNull()
    expect(acquirePurgeLock(path)).toBeNull()

    release!()
    expect(existsSync(path)).toBe(false)
    expect(acquirePurgeLock(path)).not.toBeNull()
  })

  test('is taken over when it was left behind by a run that died', () => {
    let clock = 1_000_000
    acquirePurgeLock(path, () => clock)

    clock += PURGE_LOCK_STALE_MS - 1
    expect(acquirePurgeLock(path, () => clock)).toBeNull()

    clock += 2
    expect(acquirePurgeLock(path, () => clock)).not.toBeNull()
  })

  test('sits beside the database, where the API and the scheduler both look', () => {
    expect(purgeLockPath({ DB_DATABASE_PATH: '/var/lib/postline/postline.sqlite' }, '/srv/app/releases/7')).toBe('/var/lib/postline/postline.sqlite.purge.lock')
    expect(purgeLockPath({ DB_DATABASE_PATH: 'database/postline.sqlite' }, '/srv/app')).toBe('/srv/app/database/postline.sqlite.purge.lock')
    // Two databases in one folder (test databases in the temp folder) never share a lock.
    expect(purgeLockPath({ DB_DATABASE_PATH: '/tmp/a.sqlite' }, '/')).not.toBe(purgeLockPath({ DB_DATABASE_PATH: '/tmp/b.sqlite' }, '/'))
    expect(purgeLockPath({}, '/srv/app')).toBe('/srv/app/storage/framework/runtime/postline-purge.lock')
  })
})
