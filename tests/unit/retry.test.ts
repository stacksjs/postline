import { describe, expect, test } from 'bun:test'
import { classifyFailure, isDue, MAX_ATTEMPTS, nextAttemptAt, parseRetryAfter } from '../../app/Support/Social/retry'

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const at = (seconds: number): string => new Date(NOW + seconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
const failure = (status: number, extra: Record<string, unknown> = {}): Error => Object.assign(new Error(`request failed (${status})`), { status, ...extra })

describe('classifying a failed publish', () => {
  test('a 429 is a rate limit and carries the wait the network asked for', () => {
    expect(classifyFailure(failure(429, { retryAfter: '60' }), NOW)).toEqual({ kind: 'rate-limited', afterSeconds: 60 })
    expect(classifyFailure(failure(429, { headers: new Headers({ 'retry-after': '120' }) }), NOW)).toEqual({ kind: 'rate-limited', afterSeconds: 120 })
    expect(classifyFailure(failure(429), NOW)).toEqual({ kind: 'rate-limited' })
  })

  test('a server error or no answer is transient', () => {
    expect(classifyFailure(failure(503), NOW).kind).toBe('transient')
    expect(classifyFailure(new Error('fetch failed'), NOW).kind).toBe('transient')
    expect(classifyFailure(new Error('The operation timed out'), NOW).kind).toBe('transient')
  })

  test('a refusal is permanent: sending again would be refused again', () => {
    expect(classifyFailure(failure(401), NOW).kind).toBe('permanent')
    expect(classifyFailure(failure(422), NOW).kind).toBe('permanent')
    expect(classifyFailure(new Error('Bluesky posts must be 300 characters or fewer.'), NOW).kind).toBe('permanent')
  })

  test('Retry-After as a date', () => {
    expect(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90)
    expect(parseRetryAfter('soon', NOW)).toBeUndefined()
  })
})

describe('when to send again', () => {
  test('a 429 with Retry-After: 60 is retried after a minute and not before', () => {
    const next = nextAttemptAt({ kind: 'rate-limited', afterSeconds: 60 }, 1, NOW)
    expect(next).toBe(at(60))
    expect(isDue(next, NOW + 59_000)).toBe(false)
    expect(isDue(next, NOW + 60_000)).toBe(true)
  })

  test('a rate limit with no stated wait waits out a fifteen-minute window', () => {
    expect(nextAttemptAt({ kind: 'rate-limited' }, 1, NOW)).toBe(at(15 * 60))
  })

  test('a transient failure backs off: 1, 2, 4, 8 minutes', () => {
    expect([1, 2, 3, 4].map(attempts => nextAttemptAt({ kind: 'transient' }, attempts, NOW))).toEqual([at(60), at(120), at(240), at(480)])
  })

  test('it stops after the last attempt, and never retries a refusal', () => {
    expect(nextAttemptAt({ kind: 'transient' }, MAX_ATTEMPTS, NOW)).toBeNull()
    expect(nextAttemptAt({ kind: 'permanent' }, 1, NOW)).toBeNull()
    expect(nextAttemptAt(undefined, 1, NOW)).toBeNull()
  })

  test('a network cannot park a post for days', () => {
    expect(nextAttemptAt({ kind: 'rate-limited', afterSeconds: 7 * 86_400 }, 1, NOW)).toBe(at(6 * 3600))
  })
})
