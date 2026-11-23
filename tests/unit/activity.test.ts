import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { activity } from '../../app/Services/ActivityService'

const database = db as any

async function post(body: string): Promise<number> {
  const uuid = crypto.randomUUID()
  const account = await database.selectFrom('accounts').select(['id']).executeTakeFirst()
  await database.insertInto('posts').values({ uuid, title: body.slice(0, 80), body, status: 'published', source: 'composer', timezone: 'UTC', account_id: account?.id ?? null }).execute()
  return Number((await database.selectFrom('posts').select(['id']).where('uuid', '=', uuid).executeTakeFirstOrThrow()).id)
}

async function send(postId: number, provider: string, values: Record<string, unknown>): Promise<void> {
  await database.insertInto('post_targets').values({ uuid: crypto.randomUUID(), provider, post_id: postId, ...values }).execute()
}

describe('the activity feed', () => {
  test('lists sends newest first, with where each went and why one failed', async () => {
    const postId = await post('Shipping the activity view today, with a longer sentence to cut.')
    await send(postId, 'blog', { status: 'published', remote_uri: 'https://example.com/blog/shipping' })
    await send(postId, 'mastodon', { status: 'failed', failure_reason: 'Too many requests.', attempts: 2, next_attempt_at: '2099-01-01 10:00:00' })
    await send(postId, 'bluesky', { status: 'scheduled' })

    const mine = (await activity.feed({ limit: 200 })).events.filter(event => event.postId === postId)

    expect(mine.map(event => event.provider)).toEqual(['mastodon', 'blog'])
    expect(mine[0]).toMatchObject({ kind: 'failed', reason: 'Too many requests.', attempts: 2, nextAttemptAt: '2099-01-01T10:00:00Z' })
    expect(mine[1]).toMatchObject({ kind: 'published', url: 'https://example.com/blog/shipping', reason: null, nextAttemptAt: null })
    expect(mine[1]!.excerpt).toContain('Shipping the activity view')
  })

  test('a remote id that is not a web address is not offered as a link', async () => {
    const postId = await post('at uri')
    await send(postId, 'bluesky', { status: 'published', remote_uri: 'at://did:plc:abc/app.bsky.feed.post/xyz' })

    const event = (await activity.feed({ limit: 200 })).events.find(entry => entry.postId === postId)!
    expect(event.url).toBeNull()
  })

  test('filters to failures, and pages without repeating a row', async () => {
    const postId = await post('paged')
    for (let index = 0; index < 5; index++)
      await send(postId, 'blog', { status: index % 2 ? 'failed' : 'published', failure_reason: index % 2 ? 'No.' : null })

    const failures = (await activity.feed({ kind: 'failed', limit: 200 })).events
    expect(failures.every(event => event.kind === 'failed')).toBe(true)

    const seen: number[] = []
    let before: number | null = null
    for (let page = 0; page < 500; page++) {
      const result = await activity.feed({ before, limit: 2 })
      seen.push(...result.events.map(event => event.id))
      before = result.nextCursor
      if (!before) break
    }
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toEqual([...seen].sort((a, b) => b - a))
  })
})
