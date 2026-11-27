import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from 'bun:test'

test('a fresh workspace admits exactly one owner when two people register', async () => {
  const child = Bun.spawn([
    process.execPath, 'test', './tests/support/first-owner-race.ts',
  ], {
    cwd: join(import.meta.dir, '../..'),
    env: { ...process.env, POSTLINE_SITE: '', POSTLINE_DESKTOP_AGENT: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(status, stderr).toBe(0)
}, 20_000)
