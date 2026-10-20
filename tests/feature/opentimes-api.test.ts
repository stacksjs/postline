/**
 * Feature tests for the authenticated Open Times API.
 *
 * These cover the surface the app shell calls on every page load, and exist
 * because a unit suite structurally cannot catch what broke before: campaigns,
 * listening and the accounts purge had no tables at all, so every one of those
 * endpoints answered 500 while the unit tests passed. A unit test exercises a
 * function; only a request exercises the route, the middleware and the schema
 * together.
 *
 * `featureTest().actingAs(user)` is the framework's own helper — it signs the
 * request as a user without going through the login form, which is why these
 * need no fixed test password. That matters more than usual here: browser
 * sign-in is currently broken (#45), and these tests pass regardless, because
 * they exercise the API rather than the cookie the client cannot read.
 */
import { describe, expect, test } from 'bun:test'
import { featureTest } from '@stacksjs/testing'
import User from '../../storage/framework/defaults/app/Models/User'

/** Every Open Times endpoint below is behind `middleware('auth')`. */
async function actingUser() {
  const existing = await User.first()
  if (existing) return existing

  return await User.create({
    name: 'Feature Test',
    email: `feature-${Date.now()}@theopentimes.test`,
    password: 'not-used-actingAs-bypasses-login',
  })
}

describe('open times api — auth', () => {
  test.each([
    ['/api/ot/providers'],
    ['/api/ot/analytics'],
    ['/api/ot/queue'],
    ['/api/ot/campaigns'],
    ['/api/ot/listening'],
  ])('%s rejects an unauthenticated request', async (path) => {
    const response = await featureTest().get(path)

    // 401, not 500. A missing table used to surface here as a server error,
    // which reads as "the app is broken" rather than "you are not signed in".
    expect(response.status).toBe(401)
  })
})

describe('open times api — reads', () => {
  test('providers answers with the connected-channel list', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/ot/providers')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { providers: unknown[], accounts: unknown[] } }>()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.providers)).toBe(true)
    // `accounts` arrived with multi-account support; asserted so a regression
    // to the single-account shape fails here rather than in the UI.
    expect(Array.isArray(body.data.accounts)).toBe(true)
  })

  test('queue answers with the scheduled items', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/ot/queue')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { items: unknown[] } }>()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.items)).toBe(true)
  })

  test('analytics answers with stats and a series', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/ot/analytics')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { stats: unknown, series: unknown[] } }>()
    expect(body.ok).toBe(true)
    // fillStats() reads `stats` straight off this payload. It guards the
    // absence now, but a response without it still means a blank dashboard.
    expect(body.data.stats).toBeDefined()
    expect(Array.isArray(body.data.series)).toBe(true)
  })
})

describe('open times api — the endpoints that had no table', () => {
  /**
   * The regression guard for the migration gap. Before the pending migrations
   * ran, each of these answered 500 with "no such table" — and the same class
   * of gap reappeared later with email_suppressions, which no migration
   * created until one was written for it.
   */
  test('campaigns answers rather than failing on a missing table', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/ot/campaigns')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { campaigns: unknown[] } }>()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.campaigns)).toBe(true)
  })

  test('listening answers with monitors and mentions', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/ot/listening')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { monitors: unknown[], mentions: unknown[] } }>()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.monitors)).toBe(true)
    expect(Array.isArray(body.data.mentions)).toBe(true)
  })
})
