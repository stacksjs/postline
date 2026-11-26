/**
 * SQLite under load (#215): the API, the scheduler and the desktop agent are
 * separate processes on one file. Two processes writing at once must lose
 * nothing and fail nothing: a busy database is waited out, not an error.
 */
import { describe, expect, test } from 'bun:test'
import { copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { Database } from 'bun:sqlite'

describe('sqlite under load', () => {
  test('two processes writing together lose no write', async () => {
    const source = String(process.env.DB_DATABASE_PATH)
    const file = join(tmpdir(), `postline-contention-${process.pid}-${Date.now()}.sqlite`)
    copyFileSync(source, file)
    const writer = join(import.meta.dir, '../support/contention-writer.ts')
    const env = { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE_PATH: file }
    try {
      const runs = ['api', 'scheduler'].map(tag => Bun.spawn([process.execPath, writer, tag, '200'], { env, cwd: join(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' }))
      const results = await Promise.all(runs.map(async run => ({ code: await run.exited, out: await new Response(run.stdout).text(), err: await new Response(run.stderr).text() })))
      for (const result of results) {
        expect(result.code, result.err.slice(-800)).toBe(0)
        expect(result.out).toContain('landed 200')
      }
      const sqlite = new Database(file, { readonly: true })
      const row = sqlite.query(`SELECT COUNT(*) AS n FROM alerts WHERE dedupe_key LIKE 'contention:%'`).get() as { n: number }
      sqlite.close()
      expect(row.n).toBe(400)
    }
    finally {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true })
    }
  }, 120_000)
})
