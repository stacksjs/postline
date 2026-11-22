/**
 * One deletion run at a time, across processes.
 *
 * The manual purge runs in the API process and the daily one in the scheduler.
 * They share nothing in memory, so the lock is a file beside the database,
 * which is the one place both are guaranteed to see. It records who holds it
 * and when it was taken, and a lock older than any run could last is treated
 * as left behind by a process that died.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

/** Longer than a full run: 2,000 deletions per account at a quarter second each, with room to spare. */
export const PURGE_LOCK_STALE_MS = 2 * 60 * 60 * 1000

export function purgeLockPath(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  const database = String(env.DB_DATABASE_PATH || '').trim()
  const folder = database
    ? dirname(isAbsolute(database) ? database : resolve(cwd, database))
    : join(cwd, 'storage/framework/runtime')
  return join(folder, 'postline-purge.lock')
}

/**
 * Take the lock. Returns a function that releases it, or null when another
 * run holds it.
 */
export function acquirePurgeLock(path: string = purgeLockPath(), now: () => number = () => Date.now()): (() => void) | null {
  mkdirSync(dirname(path), { recursive: true })

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // `wx` fails if the file exists, which is what makes this a lock: of
      // two processes arriving together, the filesystem lets one create it.
      const handle = openSync(path, 'wx', 0o600)
      writeSync(handle, JSON.stringify({ pid: process.pid, at: now() }))
      closeSync(handle)
      return () => rmSync(path, { force: true })
    }
    catch {
      let takenAt = 0
      try {
        takenAt = Number(JSON.parse(readFileSync(path, 'utf8')).at) || 0
      }
      catch {}
      if (now() - takenAt < PURGE_LOCK_STALE_MS)
        return null
      // Left behind. Clear it and try once more.
      rmSync(path, { force: true })
    }
  }

  return null
}
