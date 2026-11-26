/**
 * Upgrading a v0.1.1 Mac app (#238): its database, with an owner's account, a
 * connected account and posts in it, opens in this release with every row
 * intact, after a copy is put aside and the new migrations are applied.
 *
 * tests/fixtures/desktop-v0.1.1.sqlite is the database v0.1.1's own build
 * made (`git worktree add <dir> v0.1.1 && bun scripts/desktop-bundle.ts`),
 * with that owner data added.
 */
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const root = join(import.meta.dir, '../..')

describe('upgrading the Mac app from v0.1.1', () => {
  test('keeps every row and applies the new migrations after a backup', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'postline-upgrade-'))
    try {
      copyFileSync(join(root, 'tests/fixtures/desktop-v0.1.1.sqlite'), join(dataDir, 'postline.sqlite'))
      const run = Bun.spawnSync([process.execPath, join(root, 'tests/support/desktop-upgrade-run.ts'), dataDir, String(process.env.DB_DATABASE_PATH)], { cwd: root, env: { ...process.env, POSTLINE_DESKTOP_AGENT: '' }, stdout: 'pipe', stderr: 'pipe' })
      expect(run.exitCode, run.stderr.toString().slice(-1500)).toBe(0)
      const result = JSON.parse(run.stdout.toString().trim().split('\n').pop()!) as { applied: string[], created: boolean }

      expect(result.created).toBe(false)
      expect(result.applied.length).toBeGreaterThan(0)
      expect(readdirSync(dataDir).some(name => /^postline\.before-.+\.sqlite$/.test(name))).toBe(true)

      const db = new Database(join(dataDir, 'postline.sqlite'), { readonly: true })
      expect(db.query('SELECT workspace_name, timezone FROM accounts WHERE id = 1').get()).toEqual({ workspace_name: 'Upgrade Workspace', timezone: 'Europe/Berlin' })
      expect(db.query('SELECT handle, access_token, refresh_token FROM social_identities WHERE id = 1').get()).toEqual({ handle: 'owner.bsky.social', access_token: 'plain-access-token-v011', refresh_token: 'plain-refresh-token-v011' })
      expect(db.query('SELECT status FROM posts ORDER BY id').all()).toEqual([{ status: 'published' }, { status: 'scheduled' }])
      expect(db.query('SELECT remote_uri FROM post_targets WHERE id = 1').get()).toEqual({ remote_uri: 'at://did:plc:owner/app.bsky.feed.post/3kv011' })
      // Columns added since v0.1.1 are there, with their defaults.
      expect(db.query('SELECT publishing_paused FROM accounts WHERE id = 1').get()).toEqual({ publishing_paused: 0 })
      db.close()
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }, 60_000)
})
