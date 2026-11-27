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
      data: { workspace: unknown, providers: { provider: string }[], accounts: unknown[], unread: unknown, networkApps: { provider: string }[] }
    }>()
    expect(body.ok).toBe(true)
    expect(body.data.workspace).toMatchObject({ workspaceName: expect.any(String), timezone: expect.any(String) })
    expect(body.data.providers.map(provider => provider.provider)).toEqual(['bluesky', 'twitter', 'linkedin', 'instagram', 'threads', 'mastodon', 'blog'])
    expect(Array.isArray(body.data.accounts)).toBe(true)
    expect(body.data.unread).toEqual({ inbox: expect.any(Number), listening: expect.any(Number) })
    expect(body.data.networkApps.map(app => app.provider)).toEqual(['twitter', 'linkedin', 'instagram', 'threads'])
    expect(body.data.networkApps.every(app => !Object.hasOwn(app, 'clientSecret'))).toBe(true)
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

  test('calendar dates find older scheduled and published posts past the first list page', async () => {
    const providers = ['bluesky']
    const scheduled = await postQueue.save({ text: 'Calendar fixture', providers, scheduledAt: '2099-04-02 15:00:00' })
    const published = await postQueue.save({ text: 'Calendar history fixture', providers })
    const database = db as any
    await database.updateTable('posts').set({ status: 'published', published_at: '2099-04-03 00:00:00' }).where('id', '=', published.postId).execute()
    for (let index = 0; index < 51; index++)
      await postQueue.save({ text: `Later draft ${index}`, providers })

    const client = featureTest().actingAs(await actingUser())
    const response = await client.get('/api/postline/queue?calendar_from=2099-04-01&calendar_to=2099-04-08')
    response.assertStatus(200)
    const result = await response.json<{ data: { items: Array<{ id: number }> } }>()
    expect(result.data.items.map(item => item.id)).toEqual([published.postId, scheduled.postId])
    const malformed = await client.get('/api/postline/queue?calendar_from=2099-04-01&calendar_to=2099-05-08')
    malformed.assertStatus(422)
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

describe('rescheduling the queue', () => {
  test('moves five posts and their targets by one week in a single authenticated request', async () => {
    const posts = []
    for (let day = 1; day <= 5; day++) {
      const scheduledAt = `2099-02-0${day} 15:00:00`
      const { postId } = await postQueue.save({ text: `Post ${day}`, providers: ['bluesky'], scheduledAt })
      posts.push({ id: postId, scheduledAt })
    }
    const request = { posts, days: 7 }
    const path = '/api/postline/queue/reschedule'
    const guest = await featureTest().post(path, request)
    guest.assertStatus(401)
    const client = featureTest().actingAs(await actingUser())
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client.post(path, request)
      response.assertStatus(200)
      expect(await response.json()).toMatchObject({ ok: true, data: { count: 5 } })
    }
    const database = db as any
    for (const { id, scheduledAt } of posts) {
      const moved = new Date(Date.parse(scheduledAt.replace(' ', 'T') + 'Z') + 7 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')
      const post = await database.selectFrom('posts').select(['scheduled_at', 'status']).where('id', '=', id).executeTakeFirst()
      const targets = await database.selectFrom('post_targets').select(['scheduled_at', 'status']).where('post_id', '=', id).execute()
      expect(post).toEqual({ scheduled_at: moved, status: 'scheduled' })
      expect(targets).toEqual([{ scheduled_at: moved, status: 'scheduled' }])
    }
  })

  test('a stale selection leaves the entire batch untouched', async () => {
    const scheduledAt = '2099-02-01 15:00:00'
    const first = await postQueue.save({ text: 'First', providers: ['bluesky'], scheduledAt })
    const other = await postQueue.save({ text: 'Already a draft', providers: ['bluesky'] })
    const posts = [first, other].map(post => ({ id: post.postId, scheduledAt }))
    const response = await featureTest().actingAs(await actingUser()).post('/api/postline/queue/reschedule', { posts, days: 7 })
    response.assertStatus(409)
    expect((await postQueue.get(first.postId))?.scheduledAt).toBe(scheduledAt)
  })
})

describe('removing posts from the queue', () => {
  test('bulk removal is atomic and its undo receipt survives a new request', async () => {
    const client = featureTest().actingAs(await actingUser())
    const schedule = '2099-07-01 15:00:00'
    const scheduled = await postQueue.save({ text: 'Scheduled removal', providers: ['bluesky'], scheduledAt: schedule })
    const draft = await postQueue.save({ text: 'Draft removal', providers: ['bluesky'] })
    const ids = [scheduled.postId, draft.postId]
    const path = '/api/postline/queue/delete'

    const stale = await client.post(path, { ids: [...ids, 999999] })
    stale.assertStatus(409)
    expect((await postQueue.get(scheduled.postId)).status).toBe('scheduled')

    const removed = await client.post(path, { ids })
    removed.assertStatus(200)
    const { data: receipt } = await removed.json<{ data: { count: number, token: string } }>()
    expect(receipt.count).toBe(2)
    const queued = await client.get('/api/postline/queue?include_undo=1&limit=500')
    queued.assertStatus(200)
    const { data: queue } = await queued.json<{ data: { items: Array<{ id: number }>, removals: Array<{ token: string, count: number }> } }>()
    expect(queue.items.every(post => !ids.includes(post.id))).toBe(true)
    expect(queue.removals).toContainEqual(expect.objectContaining({ count: 2, token: receipt.token }))

    const token = receipt.token
    const guestUndo = await featureTest().post('/api/postline/queue/undo-delete', { token })
    guestUndo.assertStatus(401)
    const restored = await client.post('/api/postline/queue/undo-delete', { token })
    restored.assertStatus(200)
    expect(await restored.json()).toEqual({ ok: true, data: { count: 2 } })
    expect(await postQueue.get(scheduled.postId)).toMatchObject({ status: 'scheduled', scheduledAt: schedule, targets: ['bluesky'] })
    expect(await postQueue.get(draft.postId)).toMatchObject({ status: 'draft', scheduledAt: null, targets: ['bluesky'] })
  })
})

describe('queued thread drafts', () => {
  test('saves, reopens and schedules the entire thread in order', async () => {
    const client = featureTest().actingAs(await actingUser())
    const texts = ['Thread opening', 'The middle', 'The end']
    const created = await client.post('/api/postline/queue', { thread: texts, providers: 'bluesky' })
    created.assertStatus(200)
    const draft = (await created.json<{ data: { postIds: number[], status: string, scheduledAt: string } }>()).data
    expect(draft).toMatchObject({ status: 'draft', scheduledAt: null })
    expect(draft.postIds).toHaveLength(3)
    const id = draft.postIds[1]!
    const read = await client.get(`/api/postline/queue/item?id=${id}`)
    read.assertStatus(200)
    expect(await read.json()).toMatchObject({ data: { status: 'draft', thread: { postIds: draft.postIds, texts } } })

    const scheduledAt = '2099-04-08 15:45:00'
    const revised = ['Revised thread opening', 'Revised ending']
    const scheduled = await client.post('/api/postline/queue/update', { id, thread: revised, providers: 'bluesky', scheduled_at: scheduledAt })
    scheduled.assertStatus(200)
    expect(await scheduled.json()).toMatchObject({ data: { postIds: draft.postIds.slice(0, 2), status: 'scheduled', scheduledAt } })
    expect((await postQueue.get(id)).thread?.texts).toEqual(revised)
    await expect(postQueue.get(draft.postIds[2]!)).rejects.toThrow('Post not found')
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
