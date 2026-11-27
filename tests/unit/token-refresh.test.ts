import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toPublicAccount } from '../../app/Support/Social/accounts'
import { isRefusedRefresh, needsRefresh, refreshOnce, tokenLifetime } from '../../app/Support/Social/token-refresh'

function at(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

const HOUR = 3600
const DAY = 24 * HOUR
let nextId = 1000

function identity(provider: string, expiresIn: number, extra: Record<string, unknown> = {}) {
  return { id: nextId++, provider, handle: 'me', access_token: 'old', refresh_token: 'r1', token_expires_at: at(expiresIn), ...extra }
}

function lockFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'postline-token-')), 'token.lock')
}

describe('when a token is renewed', () => {
  test('an X token with an hour left is not refreshed on every call', () => {
    expect(needsRefresh(identity('twitter', HOUR))).toBe(false)
    expect(needsRefresh(identity('twitter', 5 * 60))).toBe(true)
  })

  test('a 60-day token is renewed in its last week', () => {
    expect(needsRefresh(identity('threads', 10 * DAY))).toBe(false)
    expect(needsRefresh(identity('threads', 6 * DAY))).toBe(true)
    expect(needsRefresh(identity('linkedin', 6 * DAY))).toBe(true)
  })

  test('a token with no recorded expiry is left alone', () => {
    expect(needsRefresh(identity('twitter', 0, { token_expires_at: null }))).toBe(false)
  })
})

describe('refreshing once', () => {
  test('callers arriving together send one refresh', async () => {
    const row = identity('twitter', 60)
    let stored = row
    let calls = 0
    const steps = {
      lockFile: lockFile(),
      reload: async () => stored,
      refresh: async (current: typeof row) => {
        calls++
        await Bun.sleep(20)
        stored = { ...current, access_token: 'new', refresh_token: 'r2', token_expires_at: at(2 * HOUR) }
        return stored
      },
      refused: async () => {},
    }

    const results = await Promise.all([refreshOnce(row, steps), refreshOnce(row, steps), refreshOnce(row, steps)])

    expect(calls).toBe(1)
    expect(results.map(result => result?.access_token)).toEqual(['new', 'new', 'new'])
  })

  test('does not contact the network if the active credential disappeared', async () => {
    const row = identity('threads', 60)
    let refreshes = 0
    const result = await refreshOnce(row, {
      lockFile: lockFile(),
      reload: async () => undefined,
      refresh: async (current) => { refreshes++; return current },
      refused: async () => {},
    })
    expect(refreshes).toBe(0)
    expect(result).toBeUndefined()
  })

  test('a row another process already refreshed is used, not refreshed again', async () => {
    const row = identity('twitter', 60)
    let calls = 0
    const result = await refreshOnce(row, {
      lockFile: lockFile(),
      reload: async () => ({ ...row, access_token: 'theirs', refresh_token: 'r2', token_expires_at: at(2 * HOUR) }),
      refresh: async (current) => { calls++; return current },
      refused: async () => {},
    })

    expect(calls).toBe(0)
    expect(result?.access_token).toBe('theirs')
    expect(result?.refresh_token).toBe('r2')
  })

  test('while another process holds the lock, no second refresh is sent', async () => {
    const row = identity('twitter', 60)
    const path = lockFile()
    writeFileSync(path, JSON.stringify({ pid: 1, at: Date.now() }))
    let calls = 0
    let waits = 0

    const result = await refreshOnce(row, {
      lockFile: path,
      // Stop waiting at once: the real wait is fifteen seconds.
      wait: async () => { waits++; writeFileSync(path, JSON.stringify({ pid: 1, at: Date.now() })); if (waits > 2) throw new Error('stop') },
      reload: async () => row,
      refresh: async (current) => { calls++; return current },
      refused: async () => {},
    }).catch(() => row)

    expect(calls).toBe(0)
    expect(result?.access_token).toBe('old')
  })

  test('a refusal marks the account, a network failure does not', async () => {
    const refused: number[] = []
    const run = async (error: unknown) => {
      const row = identity('linkedin', DAY)
      const result = await refreshOnce(row, {
        lockFile: lockFile(),
        reload: async () => row,
        refresh: async () => { throw error },
        refused: async (current) => { refused.push(current.id) },
      })
      return { row, result }
    }

    const denied = await run(Object.assign(new Error('invalid_grant'), { status: 400 }))
    const offline = await run(new Error('fetch failed'))

    expect(refused).toEqual([denied.row.id])
    expect(denied.result?.access_token).toBe('old')
    expect(offline.result?.access_token).toBe('old')
  })

  test('which failures are refusals', () => {
    expect(isRefusedRefresh(Object.assign(new Error('x'), { status: 401 }))).toBe(true)
    expect(isRefusedRefresh(Object.assign(new Error('x'), { status: 429 }))).toBe(false)
    expect(isRefusedRefresh(Object.assign(new Error('x'), { status: 503 }))).toBe(false)
    expect(isRefusedRefresh(new Error('Token request failed: invalid_grant'))).toBe(true)
    expect(isRefusedRefresh(new Error('fetch failed'))).toBe(false)
  })
})

describe('what the owner is told', () => {
  test('a token Postline renews is not a warning', () => {
    expect(tokenLifetime(identity('twitter', 5 * 60))).toMatchObject({ renewal: 'automatic', expiresSoon: false })
    expect(tokenLifetime(identity('threads', 20 * DAY))).toMatchObject({ renewal: 'automatic', expiresSoon: false })
  })

  test('a renewable token that got too close means renewing is failing', () => {
    expect(tokenLifetime(identity('threads', 2 * DAY)).expiresSoon).toBe(true)
  })

  test('a token nothing can renew warns a week ahead', () => {
    const noRefresh = { refresh_token: null }
    expect(tokenLifetime(identity('linkedin', 20 * DAY, noRefresh))).toMatchObject({ renewal: 'reconnect', expiresSoon: false })
    expect(tokenLifetime(identity('linkedin', 5 * DAY, noRefresh))).toMatchObject({ renewal: 'reconnect', expiresSoon: true })
  })

  test('the account shape carries the lifetime and never the tokens', () => {
    const account = toPublicAccount({ ...identity('linkedin', 5 * DAY, { refresh_token: null }), auth_status: 'connected' })
    expect(account.expiresSoon).toBe(true)
    expect(account.expiresAt).toMatch(/Z$/)
    expect(JSON.stringify(account)).not.toContain('old')
  })
})
