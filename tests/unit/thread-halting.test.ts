/**
 * A thread stops on an account at the first post that fails there.
 *
 * It used to carry on: the remaining posts went out as a thread with a hole
 * in it, or as unrelated posts on a network that does not chain.
 */
import type { ProviderPublisher } from '../../app/Services/Social/CrosspostService'
import type { CrosspostTargetResult } from '../../app/Support/Social/types'
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { CrosspostService } from '../../app/Services/Social/CrosspostService'

const database = db as any

/** A network that fails on the given 1-based segment numbers and records every send. */
function network(provider: string, failOn: number[] = []): { publisher: ProviderPublisher, sent: string[] } {
  const sent: string[] = []
  let call = 0
  return {
    sent,
    publisher: {
      async publishToPost(post): Promise<CrosspostTargetResult> {
        call++
        sent.push(post.body)
        const ok = !failOn.includes(call)
        await database.insertInto('post_targets').values({
          uuid: crypto.randomUUID(),
          provider,
          status: ok ? 'published' : 'failed',
          failure_reason: ok ? null : 'The network said no.',
          post_id: post.id,
        }).execute()
        return { provider, ok, error: ok ? undefined : 'The network said no.', target: provider } as CrosspostTargetResult
      },
    },
  }
}

async function rows(postIds: number[]): Promise<Array<{ provider: string, status: string, failure_reason: string | null }>> {
  const all = await database.selectFrom('post_targets').select(['post_id', 'provider', 'status', 'failure_reason']).execute()
  return postIds.flatMap(id => all.filter((row: any) => Number(row.post_id) === id))
}

const five = ['one', 'two', 'three', 'four', 'five']

describe('a thread whose post fails', () => {
  test('sends nothing after the failure on that network', async () => {
    const blog = network('blog', [3])
    const service = new CrosspostService({ blog: blog.publisher } as never)

    const { postIds, results } = await service.publishThread(five, ['blog'])

    expect(blog.sent).toEqual(['one', 'two', 'three'])
    expect(results.map(result => result.ok)).toEqual([true, true, false, false, false])
    expect(results[3]?.error).toContain('post 3 of 5')
    expect((await rows(postIds)).map(row => row.status)).toEqual(['published', 'published', 'failed', 'failed', 'failed'])
  })

  test('records why the later posts were held back', async () => {
    const blog = network('blog', [1])
    const service = new CrosspostService({ blog: blog.publisher } as never)

    const { postIds } = await service.publishThread(['first', 'second'], ['blog'])

    expect(blog.sent).toEqual(['first'])
    const [, heldBack] = await rows(postIds)
    expect(heldBack?.failure_reason).toContain('held back')
  })

  test('carries on with the networks that did not fail', async () => {
    const blog = network('blog', [2])
    const mastodon = network('mastodon')
    const service = new CrosspostService({ blog: blog.publisher, mastodon: mastodon.publisher } as never)

    await service.publishThread(five, ['blog', 'mastodon'])

    expect(blog.sent).toEqual(['one', 'two'])
    expect(mastodon.sent).toEqual(five)
  })

  test('a thread with no failure sends every post', async () => {
    const blog = network('blog')
    const service = new CrosspostService({ blog: blog.publisher } as never)

    const { results } = await service.publishThread(five, ['blog'])

    expect(blog.sent).toEqual(five)
    expect(results.every(result => result.ok)).toBe(true)
  })
})

describe('a network that throws instead of answering', () => {
  test('is recorded as a failure with its reason, and the others still go out', async () => {
    const { CrosspostService } = await import('../../app/Services/Social/CrosspostService')
    const { db } = await import('@stacksjs/database')
    const sent: string[] = []
    const service = new CrosspostService({
      mastodon: { async publishToPost() { throw new Error('socket hang up') } },
      blog: {
        async publishToPost(post: { id: number }) {
          sent.push('blog')
          await (db as any).insertInto('post_targets').values({ uuid: crypto.randomUUID(), provider: 'blog', status: 'published', post_id: post.id }).execute()
          return { provider: 'blog', ok: true, target: 'blog' }
        },
      },
    } as never)
    const uuid = crypto.randomUUID()
    await (db as any).insertInto('posts').values({ uuid, title: 't', body: 't', status: 'draft', source: 'composer', timezone: 'UTC' }).execute()
    const postId = Number((await (db as any).selectFrom('posts').select(['id']).where('uuid', '=', uuid).executeTakeFirstOrThrow()).id)

    const results = await service.publishExisting({ id: postId, body: 't' }, [{ provider: 'mastodon', identityId: null }, { provider: 'blog', identityId: null }] as never)

    expect(results.find(result => result.provider === 'mastodon')).toMatchObject({ ok: false, error: 'socket hang up' })
    expect(sent).toEqual(['blog'])
  })
})

describe('resuming a thread (#100)', () => {
  /** A chaining network: each post gets a uri and cid, and records what it replied to. */
  function chaining(failOn: number[] = []) {
    const sent: Array<{ body: string, replyTo?: string }> = []
    let call = 0
    const publisher: ProviderPublisher = {
      async publishToPost(post, content): Promise<CrosspostTargetResult> {
        call++
        const ok = !failOn.includes(call)
        sent.push({ body: post.body, replyTo: content?.reply?.parent?.uri })
        const uri = `at://me/${post.body}`
        await database.insertInto('post_targets').values({
          uuid: crypto.randomUUID(),
          provider: 'blog',
          status: ok ? 'published' : 'failed',
          failure_reason: ok ? null : 'The network said no.',
          remote_uri: ok ? uri : null,
          remote_cid: ok ? `cid-${post.body}` : null,
          post_id: post.id,
        }).execute()
        return { provider: 'blog', ok, uri: ok ? uri : undefined, cid: ok ? `cid-${post.body}` : undefined, error: ok ? undefined : 'The network said no.', target: 'blog' } as CrosspostTargetResult
      },
    }
    return { publisher, sent }
  }

  test('a failure at post 3 of 5 sends nothing further, and resuming carries on from 3 as replies', async () => {
    const first = chaining([3])
    const service = new CrosspostService({ blog: first.publisher } as never)
    const { postIds } = await service.publishThread(five, ['blog'])
    expect(first.sent.map(item => item.body)).toEqual(['one', 'two', 'three'])

    const threadKey = String((await database.selectFrom('posts').select(['thread_key']).where('id', '=', postIds[0]).executeTakeFirstOrThrow()).thread_key)
    const second = chaining()
    const resumed = await new CrosspostService({ blog: second.publisher } as never).resumeThread(threadKey)

    expect(resumed.resumed).toBe(1)
    expect(second.sent).toEqual([
      { body: 'three', replyTo: 'at://me/two' },
      { body: 'four', replyTo: 'at://me/three' },
      { body: 'five', replyTo: 'at://me/four' },
    ])
    // Each segment now has exactly one row, published.
    expect((await rows(postIds)).map(row => row.status)).toEqual(['published', 'published', 'published', 'published', 'published'])
  })

  test('the queue offers "resume from 3" for that thread', async () => {
    const { QueueService } = await import('../../app/Services/Social/QueueService')
    const first = chaining([3])
    const service = new CrosspostService({ blog: first.publisher } as never)
    const { postIds } = await service.publishThread(five, ['blog'])
    const page = await new QueueService(service).listPage({ limit: 500 })
    const segment = page.items.find(item => item.id === postIds[2])!
    expect(segment.thread).toEqual({ position: 3, length: 5, resumeFrom: 3 })
  })
})

describe('scheduling a thread (#255)', () => {
  test('a five-post thread goes out when due, once, in order, as one thread', async () => {
    const { QueueService } = await import('../../app/Services/Social/QueueService')
    const sent: Array<{ body: string, replyTo?: string }> = []
    const publisher: ProviderPublisher = {
      async publishToPost(post, content): Promise<CrosspostTargetResult> {
        sent.push({ body: post.body, replyTo: content?.reply?.parent?.uri })
        const uri = `at://me/${post.body}`
        await database.insertInto('post_targets').values({ uuid: crypto.randomUUID(), provider: 'blog', status: 'published', remote_uri: uri, remote_cid: `c-${post.body}`, post_id: post.id }).execute()
        return { provider: 'blog', ok: true, uri, cid: `c-${post.body}`, target: 'blog' } as CrosspostTargetResult
      },
    }
    const queue = new QueueService(new CrosspostService({ blog: publisher } as never))
    const tag = crypto.randomUUID().slice(0, 6)
    const texts = five.map(text => `${text}-${tag}`)
    const soon = new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' ')

    const saved = await queue.saveThread({ texts, providers: ['blog'], scheduledAt: soon })
    expect(saved.postIds).toHaveLength(5)

    // Make it due, then run the scheduler twice: the thread goes out once.
    await database.updateTable('posts').set({ scheduled_at: new Date(Date.now() - 1000).toISOString().slice(0, 19).replace('T', ' ') }).where('id', 'in', saved.postIds).execute()
    await queue.publishDue()
    await queue.publishDue()

    const mine = sent.filter(item => item.body.endsWith(tag))
    expect(mine.map(item => item.body)).toEqual(texts)
    expect(mine.map(item => item.replyTo)).toEqual([undefined, ...texts.slice(0, 4).map(text => `at://me/${text}`)])
    const statuses = await database.selectFrom('posts').select(['status']).where('id', 'in', saved.postIds).execute()
    expect(statuses.every((row: { status: string }) => row.status === 'published')).toBe(true)
  })

  test('a thread needs a future time and two posts', async () => {
    const { QueueService } = await import('../../app/Services/Social/QueueService')
    const queue = new QueueService()
    await expect(queue.saveThread({ texts: ['only one'], providers: ['blog'], scheduledAt: '2099-01-01 10:00:00' })).rejects.toThrow('at least two posts')
    await expect(queue.saveThread({ texts: ['a', 'b'], providers: ['blog'], scheduledAt: '2020-01-01 10:00:00' })).rejects.toThrow('future')
  })
})
