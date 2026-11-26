/**
 * Feature tests for the authenticated Postline API.
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
import { db } from '@stacksjs/database'
import { featureTest } from '@stacksjs/testing'
import { postQueue } from '../../app/Services/Social/QueueService'
import User from '../../storage/framework/defaults/app/Models/User'

/** Every Postline endpoint below is behind `middleware('auth')`. */
async function actingUser() {
  const existing = await User.first()
  if (existing) return existing

  return await User.create({
    name: 'Feature Test',
    email: `feature-${Date.now()}@postline.test`,
    password: 'not-used-actingAs-bypasses-login',
  })
}

describe('postline api — auth', () => {
  test.each([
    ['/api/postline/bootstrap'],
    ['/api/postline/providers'],
    ['/api/postline/analytics'],
    ['/api/postline/queue'],
    ['/api/postline/campaigns'],
    ['/api/postline/listening'],
    ['/api/postline/activity'],
    ['/api/postline/alerts'],
    ['/api/postline/system'],
  ])('%s rejects an unauthenticated request', async (path) => {
    const response = await featureTest().get(path)

    // 401, not 500. A missing table used to surface here as a server error,
    // which reads as "the app is broken" rather than "you are not signed in".
    expect(response.status).toBe(401)
  })
})

describe('postline api — reads', () => {
  test('bootstrap returns the workspace profile, channels, and unread counts together', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/postline/bootstrap')

    response.assertStatus(200)
    const body = await response.json<{
      ok: boolean
      data: { workspace: unknown, providers: { provider: string }[], accounts: unknown[], unread: unknown }
    }>()
    expect(body.ok).toBe(true)
    expect(body.data.workspace).toMatchObject({ workspaceName: expect.any(String), timezone: expect.any(String) })
    expect(body.data.providers.map(provider => provider.provider)).toEqual(['bluesky', 'twitter', 'linkedin', 'instagram', 'threads', 'mastodon', 'blog'])
    expect(Array.isArray(body.data.accounts)).toBe(true)
    expect(body.data.unread).toEqual({ inbox: expect.any(Number), listening: expect.any(Number) })
  })

  test('providers answers with the connected-channel list', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/postline/providers')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { providers: unknown[], accounts: unknown[] } }>()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.providers)).toBe(true)
    // `accounts` arrived with multi-account support; asserted so a regression
    // to the single-account shape fails here rather than in the UI.
    expect(Array.isArray(body.data.accounts)).toBe(true)
  })

  test('queue answers with the scheduled items', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/postline/queue')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { items: unknown[] } }>()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.items)).toBe(true)
  })

  test('post search pages across statuses and matches titles, shared text and variants literally', async () => {
    const database = db as any
    const tag = `Launch!%_${crypto.randomUUID()}`
    const providers = ['bluesky']
    const draft = await postQueue.save({ text: `Draft about ${tag}`, providers })
    const scheduled = await postQueue.save({ title: `Scheduled ${tag}`, text: 'Different shared text', scheduledAt: '2099-01-01 12:00:00', providers })
    const published = await postQueue.save({ text: 'Different shared text', variants: { bluesky: `Variant about ${tag}` }, providers })
    const archived = await postQueue.save({ text: `Archived ${tag}`, providers })
    await postQueue.save({ text: tag.replace('%_', 'many'), providers })
    await database.updateTable('posts').set({ status: 'published' }).where('id', '=', published.postId).execute()
    await database.updateTable('posts').set({ status: 'archived' }).where('id', '=', archived.postId).execute()

    const user = await actingUser()
    const search = async (before?: number) => {
      const query = new URLSearchParams({ q: tag.toLowerCase(), limit: '2' })
      if (before) query.set('before', String(before))
      const response = await featureTest().actingAs(user).get(`/api/postline/queue?${query}`)
      response.assertStatus(200)
      return (await response.json<{ data: { items: Array<{ id: number, status: string }>, nextCursor: number | null } }>()).data
    }

    const first = await search()
    expect(first.items.map(item => [item.id, item.status])).toEqual([[published.postId, 'published'], [scheduled.postId, 'scheduled']])
    expect(first.nextCursor).toBe(scheduled.postId)
    const older = await search(first.nextCursor!)
    expect(older.items.map(item => [item.id, item.status])).toEqual([[draft.postId, 'draft']])
    expect(older.nextCursor).toBeNull()
  })

  test('the menu-bar status says paused or not, the next post and unread alerts', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/postline/desktop/status')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { paused: boolean, nextPostAt: string | null, unread: number } }>()
    expect(body.ok).toBe(true)
    expect(typeof body.data.paused).toBe('boolean')
    expect(body.data.nextPostAt === null || !Number.isNaN(Date.parse(body.data.nextPostAt))).toBe(true)
    expect(typeof body.data.unread).toBe('number')
  })

  test('analytics answers with stats and a series', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/postline/analytics')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { stats: unknown, series: unknown[] } }>()
    expect(body.ok).toBe(true)
    // fillStats() reads `stats` straight off this payload. It guards the
    // absence now, but a response without it still means a blank dashboard.
    expect(body.data.stats).toBeDefined()
    expect(Array.isArray(body.data.series)).toBe(true)
  })
})

describe('postline api — the endpoints that had no table', () => {
  /**
   * The regression guard for the migration gap. Before the pending migrations
   * ran, each of these answered 500 with "no such table" — and the same class
   * of gap reappeared later with email_suppressions, which no migration
   * created until one was written for it.
   */
  test('campaigns answers rather than failing on a missing table', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/postline/campaigns')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { campaigns: unknown[] } }>()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.campaigns)).toBe(true)
  })

  test('listening answers with monitors and mentions', async () => {
    const response = await featureTest().actingAs(await actingUser()).get('/api/postline/listening')

    response.assertStatus(200)
    const body = await response.json<{ ok: boolean, data: { monitors: unknown[], mentions: unknown[] } }>()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.monitors)).toBe(true)
    expect(Array.isArray(body.data.mentions)).toBe(true)
  })
})
