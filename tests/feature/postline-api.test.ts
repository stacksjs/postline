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
import type { PostingSlot } from '../../app/Support/Social/posting-slots'
import type { TrackedLink } from '../../app/Services/TrackedLinkService'
import { describe, expect, test } from 'bun:test'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { featureTest } from '@stacksjs/testing'
import { postQueue } from '../../app/Services/Social/QueueService'
import { nextPostingSlot } from '../../app/Support/Social/posting-slots'
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
    ['/api/postline/analytics/links'],
    ['/api/postline/draft-feeds'],
    ['/api/postline/posting-slots'],
    ['/api/postline/queue'],
    ['/api/postline/setup/post-status?id=1'],
    ['/api/postline/queue/image?id=1&index=0'],
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

describe('tracked links', () => {
  test('the authenticated owner issues and disables a link, and only GET increments the total', async () => {
    type LinkWithUrl = TrackedLink & { shortUrl: string }
    const address = process.env.APP_URL
    process.env.APP_URL = 'https://workspace.example.org'
    const endpoint = '/api/postline/analytics/links'
    const submitted = { name: 'Launch', destination: 'https://example.com/launch?from=post#read', campaign: 'Summer launch' }
    let code: string | undefined
    try {
      ;(await featureTest().post(endpoint, submitted)).assertStatus(401)
      const client = featureTest().actingAs(await actingUser())
      const created = await client.post(endpoint, submitted)
      created.assertStatus(201)
      const { data } = await created.json<{ data: LinkWithUrl }>()
      code = data.code
      expect(data.shortUrl).toBe(`https://workspace.example.org/api/r/${code}`)
      expect(data.destination).toBe('https://example.com/launch?from=post&utm_campaign=Summer+launch#read')
      expect(data.visits).toBe(0)
      const path = `/api/r/${code}`
      const head = await featureTest().request('HEAD', path)
      head.assertStatus(302)
      expect(head.headers.get('location')).toBe(data.destination)
      for (let index = 0; index < 2; index++) {
        const visit = await featureTest().get(`${path}?utm_campaign=other`)
        visit.assertStatus(302)
        expect(visit.headers.get('location')).toBe(data.destination)
        expect(visit.headers.get('cache-control')).toContain('no-store')
        expect(visit.headers.get('referrer-policy')).toBe('no-referrer')
      }
      const list = await client.get(endpoint)
      expect((await list.json<{ data: { links: LinkWithUrl[] } }>()).data.links).toContainEqual({ ...data, visits: 2 })
      ;(await client.post(endpoint, { ...submitted, destination: data.shortUrl })).assertStatus(422)
      ;(await client.post(`${endpoint}/disable`, { code })).assertStatus(200)
      ;(await featureTest().get(path)).assertStatus(404)
      ;(await featureTest().request('HEAD', path)).assertStatus(404)
      const after = await client.get(endpoint)
      expect((await after.json<{ data: { links: LinkWithUrl[] } }>()).data.links).toContainEqual({ ...data, disabled: true, visits: 2 })
    }
    finally {
      if (address === undefined) delete process.env.APP_URL
      else process.env.APP_URL = address
      if (code) await db.deleteFrom('tracked_links').where('code', '=', code).execute()
    }
  })
})

describe('postline api — reads', () => {
  test('draft feed settings need a session and reject a private source before polling', async () => {
    const endpoint = '/api/postline/draft-feeds'
    const data = { name: 'Workspace service', url: 'http://localhost/feed.xml', includeExisting: true }
    ;(await featureTest().post(endpoint, data)).assertStatus(401)
    const client = featureTest().actingAs(await actingUser())
    ;(await client.post(endpoint, data)).assertStatus(422)
    ;(await client.get(endpoint)).assertStatus(200)
  })

  test('Blog previews use the publishing renderer behind authentication', async () => {
    const body = { bodies: ['An **emphasized** note.', '# A second segment'] }
    ;(await featureTest().post('/api/postline/blog/preview', body)).assertStatus(401)
    const preview = await featureTest().actingAs(await actingUser()).post('/api/postline/blog/preview', body)
    preview.assertStatus(200)
    expect(await preview.json()).toEqual({
      ok: true, data: { html: ['<p>An <strong>emphasized</strong> note.</p>\n', '<h1>A second segment</h1>\n'] },
    })
  })

  test('setup looks up the specified post even after it is published', async () => {
    const client = featureTest().actingAs(await actingUser())
    const path = '/api/postline/setup/post-status?id='
    const earlier = await postQueue.save({ text: 'An earlier publication', providers: ['blog'] })
    await (db as any).updateTable('posts').set({ status: 'published' }).where('id', '=', earlier.postId).execute()
    const first = await postQueue.save({ text: 'First post from setup', providers: ['blog'] })

    expect(await (await client.get(path + first.postId)).json()).toEqual({ ok: true, data: { status: 'draft' } })
    expect(await (await client.get(path + earlier.postId)).json()).toEqual({ ok: true, data: { status: 'published' } })
    ;(await client.get(path + '0')).assertStatus(422)
    ;(await client.get(path + Number.MAX_SAFE_INTEGER)).assertStatus(404)
  })

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

  test('analytics filters the series and reported post metrics to the selected dates', async () => {
    const client = featureTest().actingAs(await actingUser())
    const database = db as any
    const now = Date.now()
    const publish = async (text: string, daysAgo: number) => {
      const { postId } = await postQueue.save({ text, providers: ['bluesky'] })
      const sentAt = new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')
      await database.updateTable('posts').set({ status: 'published', published_at: sentAt }).where('id', '=', postId).execute()
      await database.updateTable('post_targets').set({ status: 'published', metrics: '{"likes":0,"views":12}' }).where('post_id', '=', postId).execute()
      return postId
    }
    const current = await publish('A post in both ranges', 2)
    const earlier = await publish('A post in the longer range only', 10)
    try {
      const path = '/api/postline/analytics'
      const defaultSummary = await client.get(path)
      defaultSummary.assertStatus(200)
      expect((await defaultSummary.json<{ data: { series: unknown[] } }>()).data.series).toHaveLength(30)
      for (const days of [7, 30, 90]) {
        const result = await client.get(`${path}?days=${days}&page=1`)
        result.assertStatus(200)
        const { data } = await result.json<{ data: {
          totalPosts: number
          series: Array<{ value: number }>
          posts: Array<{ id: number, targets: unknown[] }>
        } }>()
        expect(data.series).toHaveLength(days)
        expect(data.series.reduce((total, point) => total + point.value, 0)).toBe(data.totalPosts)
        expect(data.posts.find(post => post.id === current)?.targets).toContainEqual(expect.objectContaining({ provider: 'bluesky', counts: { likes: 0, views: 12 } }))
        expect(data.posts.some(post => post.id === earlier)).toBe(days !== 7)
      }
      ;(await client.get(`${path}?days=999&page=1`)).assertStatus(422)
      ;(await client.get(`${path}?days=7&page=-1`)).assertStatus(422)
    }
    finally {
      await database.deleteFrom('post_targets').where('post_id', 'in', [current, earlier]).execute()
      await database.deleteFrom('posts').where('id', 'in', [current, earlier]).execute()
    }
  })
})

describe('weekly posting slots', () => {
  test('assigns simultaneous queue requests distinct minutes and schedules a draft per network', async () => {
    type Queued = { provider: string, scheduledAt: string, postIds: number[] }
    const client = featureTest().actingAs(await actingUser())
    const endpoint = '/api/postline/posting-slots'
    const database = db as any
    const tag = crypto.randomUUID()
    const blog: PostingSlot = { provider: 'blog', weekday: 2, minute: 537 }
    const bluesky: PostingSlot = { provider: 'bluesky', weekday: 3, minute: 822 }
    const body = { text: tag, providers: 'blog,bluesky', next_slot: '1' }
    const draft = await postQueue.save({ text: tag, providers: ['blog'] })
    const original = await client.get(endpoint)
    original.assertStatus(200)
    const { data: { timezone, slots } } = await original.json<{ data: { timezone: string, slots: PostingSlot[] } }>()
    const from = new Date()
    const blogAt = nextPostingSlot([blog], timezone, from, new Set())!
    const nextBlog = nextPostingSlot([blog], timezone, from, new Set([blogAt.slice(0, 16)]))!
    const blueskyAt = nextPostingSlot([bluesky], timezone, from, new Set())!
    try {
      ;(await featureTest().post(endpoint, blog)).assertStatus(401)
      ;(await client.post(endpoint, { ...blog, minute: 1440 })).assertStatus(422)
      ;(await client.post(endpoint, blog)).assertStatus(200)
      const duplicate = await client.post(endpoint, blog)
      expect((await duplicate.json<{ data: PostingSlot[] }>()).data.filter(item => item.weekday === blog.weekday
        && item.minute === blog.minute && item.provider === blog.provider)).toHaveLength(1)

      // No network should get a post when any selected network has no slot.
      ;(await client.post('/api/postline/queue/update', { ...body, id: draft.postId })).assertStatus(422)
      expect(await postQueue.status(draft.postId)).toBe('draft')
      expect(await database.selectFrom('posts').select('id').where('body', '=', tag).execute()).toHaveLength(1)
      ;(await client.post(endpoint, bluesky)).assertStatus(200)

      const [edited, created] = await Promise.all([
        client.post('/api/postline/queue/update', { ...body, id: draft.postId }),
        client.post('/api/postline/queue', { ...body, providers: 'blog' }),
      ])
      edited.assertStatus(200)
      created.assertStatus(200)
      const editResult = await edited.json<{ data: { slots: Queued[] } }>()
      const createdResult = await created.json<{ data: { slots: Queued[] } }>()
      const networks = Object.fromEntries(editResult.data.slots.map(item => [item.provider, item]))
      expect(networks.blog?.postIds).toEqual([draft.postId])
      expect(networks.bluesky?.scheduledAt).toBe(blueskyAt)
      expect([networks.blog?.scheduledAt, createdResult.data.slots[0]?.scheduledAt].sort()).toEqual([blogAt, nextBlog])
    }
    finally {
      for (const slot of [blog, bluesky]) {
        if (!slots.some(item => item.provider === slot.provider && item.weekday === slot.weekday && item.minute === slot.minute))
          await client.post(endpoint, { ...slot, remove: true })
      }
      const posts = await database.selectFrom('posts').select('id').where('body', '=', tag).execute() as { id: number }[]
      await database.deleteFrom('post_targets').where('post_id', 'in', posts.map(post => post.id)).execute()
      await database.deleteFrom('posts').where('body', '=', tag).execute()
    }
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
