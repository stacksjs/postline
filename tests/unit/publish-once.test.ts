/**
 * A post goes out once.
 *
 * These drive the real queue service against the test database, with the
 * networks replaced by a fake that records every send. That is the only way
 * to exercise what matters here: two runs reaching for the same post, and a
 * run that stops halfway.
 */
import type { ProviderPublisher } from '../../app/Services/Social/CrosspostService'
import type { CrosspostTargetResult } from '../../app/Support/Social/types'
import { existsSync, rmSync } from 'node:fs'
import process from 'node:process'
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { CrosspostService } from '../../app/Services/Social/CrosspostService'
import { AlreadyPublishingError, MISSED_PREFIX, MissingMediaError, QueueService, STRANDED_REASON } from '../../app/Services/Social/QueueService'
import { publicMessage } from '../../app/Support/Http/action-error'

const database = db as any

interface Fake {
  publisher: ProviderPublisher
  sends: number[]
}

/** A network that records each send and writes its result row, as the real services do. */
function fakeNetwork(provider: string, options: { delayMs?: number, fail?: boolean, crash?: boolean } = {}): Fake {
  const sends: number[] = []
  const publisher: ProviderPublisher = {
    async publishToPost(post): Promise<CrosspostTargetResult> {
      sends.push(post.id)
      if (options.delayMs)
        await Bun.sleep(options.delayMs)
      if (options.crash)
        throw new Error('the process stopped here')

      await database.insertInto('post_targets').values({
        uuid: crypto.randomUUID(),
        provider,
        status: options.fail ? 'failed' : 'published',
        failure_reason: options.fail ? 'The network said no.' : null,
        post_id: post.id,
      }).execute()

      return { provider: provider as CrosspostTargetResult['provider'], ok: !options.fail, error: options.fail ? 'The network said no.' : undefined, target: provider } as CrosspostTargetResult
    },
  }
  return { publisher, sends }
}

function queueWith(fakes: Record<string, Fake>): QueueService {
  const registry = Object.fromEntries(Object.entries(fakes).map(([name, fake]) => [name, fake.publisher]))
  return new QueueService(new CrosspostService(registry as never))
}

async function status(postId: number): Promise<string> {
  return (await database.selectFrom('posts').select(['status']).where('id', '=', postId).executeTakeFirstOrThrow()).status
}

async function targets(postId: number): Promise<Array<{ provider: string, status: string, failure_reason: string | null }>> {
  return await database.selectFrom('post_targets').select(['provider', 'status', 'failure_reason']).where('post_id', '=', postId).execute()
}

async function age(postId: number, minutes: number): Promise<void> {
  const then = new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ')
  await database.updateTable('posts').set({ updated_at: then }).where('id', '=', postId).execute()
}

const stamp = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ')

/** The queue refuses a time in the past, so a due post is saved for later and then moved back. */
async function saveDue(queue: QueueService, text: string): Promise<number> {
  const { postId } = await queue.save({ text, providers: ['blog'], scheduledAt: stamp(3_600_000) })
  await database.updateTable('posts').set({ scheduled_at: stamp(-60_000) }).where('id', '=', postId).execute()
  await database.updateTable('post_targets').set({ scheduled_at: stamp(-60_000) }).where('post_id', '=', postId).execute()
  return postId
}

describe('publishing a post once', () => {
  test('fifty runs racing for one post send it once', async () => {
    const blog = fakeNetwork('blog', { delayMs: 20 })
    const queue = queueWith({ blog })
    const postId = await saveDue(queue, 'raced')

    const outcomes = await Promise.allSettled(Array.from({ length: 50 }, () => queue.publishNow(postId)))

    expect(blog.sends).toEqual([postId])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(await status(postId)).toBe('published')
    expect((await targets(postId)).map(row => row.status)).toEqual(['published'])
  })

  test('the runs that lose are told why, in words the owner can read', async () => {
    const blog = fakeNetwork('blog', { delayMs: 20 })
    const queue = queueWith({ blog })
    const { postId } = await queue.save({ text: 'twice', providers: ['blog'] })

    const [first, second] = await Promise.allSettled([queue.publishNow(postId), queue.publishNow(postId)])
    const lost = [first, second].find(outcome => outcome.status === 'rejected') as PromiseRejectedResult

    expect(lost.reason).toBeInstanceOf(AlreadyPublishingError)
    expect(publicMessage(lost.reason)).toBe('This post is already being published.')
  })

  test('two scheduler ticks at once publish each due post once', async () => {
    const blog = fakeNetwork('blog', { delayMs: 15 })
    const queue = queueWith({ blog })
    const first = { postId: await saveDue(queue, 'due one') }
    const second = { postId: await saveDue(queue, 'due two') }

    await Promise.all([queue.publishDue(), queue.publishDue(), queue.publishDue()])

    expect(blog.sends.filter(id => id === first.postId)).toHaveLength(1)
    expect(blog.sends.filter(id => id === second.postId)).toHaveLength(1)
  })

  test('a published post cannot be published again', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const { postId } = await queue.save({ text: 'once', providers: ['blog'] })
    await queue.publishNow(postId)

    await expect(queue.publishNow(postId)).rejects.toThrow()
    expect(blog.sends).toEqual([postId])
  })

  test('a failed post can be retried, and the failure is recorded', async () => {
    const failing = fakeNetwork('blog', { fail: true })
    const { postId } = await queueWith({ blog: failing }).save({ text: 'retry me', providers: ['blog'] })
    await queueWith({ blog: failing }).publishNow(postId)

    expect(await status(postId)).toBe('failed')
    expect((await targets(postId))[0]).toMatchObject({ status: 'failed', failure_reason: 'The network said no.' })

    const working = fakeNetwork('blog')
    await queueWith({ blog: working }).publishNow(postId)

    expect(await status(postId)).toBe('published')
    expect(working.sends).toEqual([postId])
  })
})

describe('a publish that never finished', () => {
  test('is left alone while it could still be running', async () => {
    const queue = queueWith({ blog: fakeNetwork('blog') })
    const { postId } = await queue.save({ text: 'still going', providers: ['blog'] })
    await database.updateTable('posts').set({ status: 'publishing' }).where('id', '=', postId).execute()
    await age(postId, 2)

    expect(await queue.recoverStranded()).toBe(0)
    expect(await status(postId)).toBe('publishing')
  })

  test('is handed back as failed, never re-sent', async () => {
    const crashing = fakeNetwork('blog', { crash: true })
    const queue = queueWith({ blog: crashing })
    const postId = await saveDue(queue, 'stopped halfway')

    // The process "stops": the claim is taken and the target marked, and the
    // results are never written.
    await database.updateTable('posts').set({ status: 'publishing' }).where('id', '=', postId).execute()
    await database.updateTable('post_targets').set({ status: 'publishing' }).where('post_id', '=', postId).execute()
    await age(postId, 30)

    const sendsBefore = crashing.sends.length
    expect(await queue.recoverStranded()).toBe(1)

    expect(crashing.sends.length).toBe(sendsBefore)
    expect(await status(postId)).toBe('failed')
    expect(await targets(postId)).toEqual([{ provider: 'blog', status: 'failed', failure_reason: STRANDED_REASON }])
  })

  test('can then be retried by the owner', async () => {
    const queue = queueWith({ blog: fakeNetwork('blog') })
    const { postId } = await queue.save({ text: 'recover then retry', providers: ['blog'] })
    await database.updateTable('posts').set({ status: 'publishing' }).where('id', '=', postId).execute()
    await database.updateTable('post_targets').set({ status: 'publishing' }).where('post_id', '=', postId).execute()
    await age(postId, 30)
    await queue.recoverStranded()

    const working = fakeNetwork('blog')
    await queueWith({ blog: working }).publishNow(postId)

    expect(working.sends).toEqual([postId])
    expect(await status(postId)).toBe('published')
    expect((await targets(postId)).map(row => row.status)).toEqual(['published'])
  })

  test('keeps what did go out and does not offer it again', async () => {
    const queue = queueWith({ blog: fakeNetwork('blog') })
    const { postId } = await queue.save({ text: 'half sent', providers: ['blog'] })
    await database.updateTable('posts').set({ status: 'publishing' }).where('id', '=', postId).execute()
    await database.updateTable('post_targets').set({ status: 'publishing' }).where('post_id', '=', postId).execute()
    // The network accepted it and the result row was written, then the process stopped.
    await database.insertInto('post_targets').values({ uuid: crypto.randomUUID(), provider: 'blog', status: 'published', post_id: postId }).execute()
    await age(postId, 30)

    await queue.recoverStranded()

    expect(await status(postId)).toBe('published')
    expect(await targets(postId)).toEqual([{ provider: 'blog', status: 'published', failure_reason: null }])
  })

  test('the scheduler recovers before it publishes', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const { postId } = await queue.save({ text: 'found by the tick', providers: ['blog'] })
    await database.updateTable('posts').set({ status: 'publishing' }).where('id', '=', postId).execute()
    await database.updateTable('post_targets').set({ status: 'publishing' }).where('post_id', '=', postId).execute()
    await age(postId, 30)

    await queue.publishDue()

    expect(await status(postId)).toBe('failed')
    expect(blog.sends).not.toContain(postId)
  })
})

describe('a post that went out on some networks and failed on others', () => {
  async function partlySent(): Promise<{ postId: number, mastodonFirst: Fake }> {
    const blog = fakeNetwork('blog')
    const mastodonFirst = fakeNetwork('mastodon', { fail: true })
    const queue = queueWith({ blog, mastodon: mastodonFirst })
    const { postId } = await queue.save({ text: 'two networks', providers: ['blog', 'mastodon'] })
    await queue.publishNow(postId)
    return { postId, mastodonFirst }
  }

  test('is published, and says which network failed', async () => {
    const { postId } = await partlySent()

    expect(await status(postId)).toBe('published')
    expect((await targets(postId)).sort((a, b) => a.provider.localeCompare(b.provider))).toEqual([
      { provider: 'blog', status: 'published', failure_reason: null },
      { provider: 'mastodon', status: 'failed', failure_reason: 'The network said no.' },
    ])

    const listed = (await queueWith({}).list()).find(item => item.id === postId)
    expect(listed?.partial).toBe(true)
  })

  test('can have only its failed network sent again', async () => {
    const { postId } = await partlySent()
    const blog = fakeNetwork('blog')
    const mastodon = fakeNetwork('mastodon')

    await queueWith({ blog, mastodon }).publishNow(postId)

    expect(blog.sends).toEqual([])
    expect(mastodon.sends).toEqual([postId])
    expect(await status(postId)).toBe('published')
    expect((await targets(postId)).map(row => row.status).sort()).toEqual(['published', 'published'])
    expect((await queueWith({}).list()).find(item => item.id === postId)?.partial).toBe(false)
  })

  test('keeps the time it first went out', async () => {
    const { postId } = await partlySent()
    const before = (await database.selectFrom('posts').select(['published_at']).where('id', '=', postId).executeTakeFirstOrThrow()).published_at
    await Bun.sleep(1100)

    await queueWith({ blog: fakeNetwork('blog'), mastodon: fakeNetwork('mastodon') }).publishNow(postId)

    const after = (await database.selectFrom('posts').select(['published_at']).where('id', '=', postId).executeTakeFirstOrThrow()).published_at
    expect(after).toBe(before)
  })

  test('stays published when the retry fails again', async () => {
    const { postId } = await partlySent()

    await queueWith({ blog: fakeNetwork('blog'), mastodon: fakeNetwork('mastodon', { fail: true }) }).publishNow(postId)

    expect(await status(postId)).toBe('published')
    expect((await targets(postId)).filter(row => row.provider === 'mastodon').map(row => row.status)).toEqual(['failed'])
  })

  test('a fully sent post has nothing left to publish', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const { postId } = await queue.save({ text: 'all done', providers: ['blog'] })
    await queue.publishNow(postId)

    await expect(queue.publishNow(postId)).rejects.toThrow('This post has nothing left to publish.')
  })

  test('keeps its image until every network has it', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    const queue = queueWith({ blog: fakeNetwork('blog'), mastodon: fakeNetwork('mastodon', { fail: true }) })
    const { postId } = await queue.save({ text: 'with a picture', providers: ['blog', 'mastodon'], image: { bytes: png, mimeType: 'image/png' } })
    const edit = async (): Promise<boolean> => (await queueWith({}).list()).find(item => item.id === postId)?.hasImage ?? false

    await queue.publishNow(postId)
    const stored = JSON.parse((await database.selectFrom('posts').selectAll().where('id', '=', postId).executeTakeFirstOrThrow()).content || '{}')
    const path = `${process.cwd()}/storage/app/postline-media/${stored.media[0].path}`
    expect(await edit()).toBe(true)
    expect(existsSync(path)).toBe(true)

    await queueWith({ blog: fakeNetwork('blog'), mastodon: fakeNetwork('mastodon') }).publishNow(postId)
    expect(existsSync(path)).toBe(false)
  })
})

describe('a scheduled post that is late', () => {
  async function saveLate(queue: QueueService, text: string, minutesLate: number): Promise<number> {
    const { postId } = await queue.save({ text, providers: ['blog'], scheduledAt: stamp(3_600_000) })
    const due = stamp(-minutesLate * 60_000)
    await database.updateTable('posts').set({ scheduled_at: due }).where('id', '=', postId).execute()
    await database.updateTable('post_targets').set({ scheduled_at: due }).where('post_id', '=', postId).execute()
    return postId
  }

  test('goes out when it is only a little late', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const postId = await saveLate(queue, 'five minutes late', 5)

    await queue.publishDue(30)

    expect(blog.sends).toContain(postId)
    expect(await status(postId)).toBe('published')
  })

  test('is held back, not sent, when it is later than the grace window', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const postId = await saveLate(queue, 'a week late', 7 * 24 * 60)

    const outcome = await queue.publishDue(30)

    expect(blog.sends).not.toContain(postId)
    expect(outcome.missed).toBeGreaterThanOrEqual(1)
    expect(await status(postId)).toBe('failed')
    const [target] = await targets(postId)
    expect(target?.status).toBe('failed')
    expect(target?.failure_reason?.startsWith(MISSED_PREFIX)).toBe(true)
  })

  test('a missed post can still be published by the owner', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const postId = await saveLate(queue, 'missed, then sent by hand', 600)
    await queue.publishDue(30)

    await queue.publishNow(postId)

    expect(blog.sends).toEqual([postId])
    expect(await status(postId)).toBe('published')
  })

  test('a week of missed posts sends none of them', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const ids: number[] = []
    for (let day = 1; day <= 7; day++) ids.push(await saveLate(queue, `day ${day}`, day * 24 * 60))

    await queue.publishDue(30)

    expect(blog.sends.filter(id => ids.includes(id))).toEqual([])
  })
})

describe('a queued post whose image has gone missing', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

  async function saveWithLostImage(queue: QueueService, scheduled: boolean): Promise<number> {
    const { postId } = await queue.save({
      text: 'had a picture',
      providers: ['blog'],
      image: { bytes: png, mimeType: 'image/png' },
      ...(scheduled ? { scheduledAt: stamp(3_600_000) } : {}),
    })
    const stored = JSON.parse((await database.selectFrom('posts').selectAll().where('id', '=', postId).executeTakeFirstOrThrow()).content || '{}')
    rmSync(`${process.cwd()}/storage/app/postline-media/${stored.media[0].path}`, { force: true })
    return postId
  }

  test('is refused, not sent without it', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const postId = await saveWithLostImage(queue, false)

    await expect(queue.publishNow(postId)).rejects.toBeInstanceOf(MissingMediaError)

    expect(blog.sends).toEqual([])
    // Refused before the claim: it is exactly as it was.
    expect(await status(postId)).toBe('draft')
  })

  test('is set aside by the scheduler with the reason, once', async () => {
    const blog = fakeNetwork('blog')
    const queue = queueWith({ blog })
    const postId = await saveWithLostImage(queue, true)
    await database.updateTable('posts').set({ scheduled_at: stamp(-60_000) }).where('id', '=', postId).execute()

    await queue.publishDue()
    await queue.publishDue()

    expect(blog.sends).toEqual([])
    expect(await status(postId)).toBe('failed')
    expect((await targets(postId))[0]?.failure_reason).toContain('image attached to this post is missing')
  })
})

describe('a network that fails for a reason sending again can fix', () => {
  /** A network that fails with the given hint until told to recover. */
  function flaky(provider: string, retry: CrosspostTargetResult['retry']): Fake & { recover: () => void } {
    const sends: number[] = []
    let failing = true
    const publisher: ProviderPublisher = {
      async publishToPost(post): Promise<CrosspostTargetResult> {
        sends.push(post.id)
        await database.insertInto('post_targets').values({
          uuid: crypto.randomUUID(),
          provider,
          status: failing ? 'failed' : 'published',
          failure_reason: failing ? 'Too many requests.' : null,
          post_id: post.id,
        }).execute()
        return { provider, ok: !failing, error: failing ? 'Too many requests.' : undefined, target: provider, ...(failing ? { retry } : {}) } as CrosspostTargetResult
      },
    }
    return { publisher, sends, recover: () => { failing = false } }
  }

  async function retryState(postId: number): Promise<{ status: string, attempts: number, next_attempt_at: string | null }> {
    return await database.selectFrom('post_targets').select(['status', 'attempts', 'next_attempt_at']).where('post_id', '=', postId).executeTakeFirstOrThrow()
  }

  async function makeDue(postId: number): Promise<void> {
    await database.updateTable('post_targets').set({ next_attempt_at: stamp(-1_000) }).where('post_id', '=', postId).execute()
  }

  /** Other tests share this database: leave nothing waiting for their scheduler runs. */
  async function settle(postId: number): Promise<void> {
    await database.updateTable('post_targets').set({ next_attempt_at: null }).where('post_id', '=', postId).execute()
  }

  test('a 429 with Retry-After: 60 is retried after a minute and not before', async () => {
    const blog = flaky('blog', { kind: 'rate-limited', afterSeconds: 60 })
    const queue = queueWith({ blog })
    const { postId } = await queue.save({ text: 'rate limited', providers: ['blog'] })

    await queue.publishNow(postId)
    const waiting = await retryState(postId)
    expect(waiting.status).toBe('failed')
    expect(Number(waiting.attempts)).toBe(1)
    const wait = Date.parse(`${String(waiting.next_attempt_at).replace(' ', 'T')}Z`) - Date.now()
    expect(wait).toBeGreaterThan(55_000)
    expect(wait).toBeLessThanOrEqual(61_000)

    // Before the minute is up the scheduler leaves it alone.
    await queue.publishDue()
    expect(blog.sends).toEqual([postId])

    // After it, the network is sent again and, having recovered, takes it.
    blog.recover()
    await makeDue(postId)
    await queue.publishDue()
    expect(blog.sends).toEqual([postId, postId])
    expect(await status(postId)).toBe('published')
    expect((await targets(postId)).map(row => row.status)).toEqual(['published'])
  })

  test('a refusal is never retried', async () => {
    const blog = flaky('blog', { kind: 'permanent' })
    const queue = queueWith({ blog })
    const { postId } = await queue.save({ text: 'refused', providers: ['blog'] })

    await queue.publishNow(postId)
    expect((await retryState(postId)).next_attempt_at).toBeNull()

    await queue.publishDue()
    expect(blog.sends).toEqual([postId])
  })

  test('it gives up after five sends and waits for the owner', async () => {
    const blog = flaky('blog', { kind: 'transient' })
    const queue = queueWith({ blog })
    const { postId } = await queue.save({ text: 'keeps failing', providers: ['blog'] })

    await queue.publishNow(postId)
    for (let run = 0; run < 8; run++) {
      await makeDue(postId).catch(() => {})
      const state = await retryState(postId)
      if (Number(state.attempts) >= 5) {
        await database.updateTable('post_targets').set({ next_attempt_at: null }).where('post_id', '=', postId).execute()
        break
      }
      await queue.publishDue()
    }

    const final = await retryState(postId)
    expect(blog.sends).toHaveLength(5)
    expect(Number(final.attempts)).toBe(5)
    expect(final.status).toBe('failed')
    await settle(postId)
  })

  test('only the network that is due is sent again', async () => {
    const blog = fakeNetwork('blog')
    const mastodon = flaky('mastodon', { kind: 'transient' })
    const queue = queueWith({ blog, mastodon })
    const { postId } = await queue.save({ text: 'one of two', providers: ['blog', 'mastodon'] })

    await queue.publishNow(postId)
    expect(await status(postId)).toBe('published')

    mastodon.recover()
    await database.updateTable('post_targets').set({ next_attempt_at: stamp(-1_000) }).where('post_id', '=', postId).where('status', '=', 'failed').execute()
    await queue.publishDue()

    expect(blog.sends).toEqual([postId])
    expect(mastodon.sends).toEqual([postId, postId])
    expect((await targets(postId)).map(row => row.status).sort()).toEqual(['published', 'published'])
  })
})

describe('paging the queue', () => {
  test('every post is reachable, none twice, in pages', async () => {
    const queue = queueWith({ blog: fakeNetwork('blog') })
    const made: number[] = []
    for (let index = 0; index < 7; index++)
      made.push((await queue.save({ text: `page ${index}`, providers: ['blog'] })).postId)

    const seen: number[] = []
    let before: number | null = null
    for (let page = 0; page < 500; page++) {
      const result = await queue.listPage({ before, limit: 3 })
      expect(result.items.length).toBeLessThanOrEqual(3)
      seen.push(...result.items.map(item => item.id))
      before = result.nextCursor
      if (!before) break
    }

    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toEqual([...seen].sort((a, b) => b - a))
    for (const id of made) expect(seen).toContain(id)
  })

  test('a post added while paging does not shift or repeat a row', async () => {
    const queue = queueWith({ blog: fakeNetwork('blog') })
    for (let index = 0; index < 4; index++)
      await queue.save({ text: `steady ${index}`, providers: ['blog'] })

    const first = await queue.listPage({ limit: 2 })
    await queue.save({ text: 'arrived mid-scroll', providers: ['blog'] })
    const second = await queue.listPage({ before: first.nextCursor, limit: 2 })

    const ids = [...first.items, ...second.items].map(item => item.id)
    expect(new Set(ids).size).toBe(4)
  })

  test('a failed network says when it will be sent again', async () => {
    const queue = queueWith({ blog: fakeNetwork('blog', { fail: true }) })
    const { postId } = await queue.save({ text: 'will retry', providers: ['blog'] })
    await queue.publishNow(postId)
    await database.updateTable('post_targets').set({ next_attempt_at: '2099-01-01 10:00:00' }).where('post_id', '=', postId).execute()

    const item = (await queue.listPage({ limit: 500 })).items.find(entry => entry.id === postId)!
    expect(item.providers[0]!.nextAttemptAt).toBe('2099-01-01T10:00:00Z')
    expect(item.providers[0]!.attempts).toBe(1)
    await database.updateTable('post_targets').set({ next_attempt_at: null }).where('post_id', '=', postId).execute()
  })
})

describe('where a queued post keeps its content', () => {
  test('a new post stores its extras in content and leaves notes alone', async () => {
    const queue = queueWith({ blog: fakeNetwork('blog') })
    const { postId } = await queue.save({ text: 'with a card', providers: ['blog'], external: { uri: 'https://example.com', title: 'Example' } })

    const row = await database.selectFrom('posts').select(['content', 'notes']).where('id', '=', postId).executeTakeFirstOrThrow()
    expect(JSON.parse(row.content).external.uri).toBe('https://example.com')
    expect(row.notes).toBeNull()
  })

  test('content parked in notes by an older version is moved across once, and a real note is not', async () => {
    const { resetLegacyContentMove } = await import('../../app/Services/Social/QueueService')
    const queue = queueWith({ blog: fakeNetwork('blog') })
    const parked = (await queue.save({ text: 'parked', providers: ['blog'] })).postId
    const noted = (await queue.save({ text: 'noted', providers: ['blog'] })).postId
    const stored = JSON.stringify({ external: { uri: 'https://example.com/old', title: 'Old' } })
    await database.updateTable('posts').set({ content: null, notes: stored }).where('id', '=', parked).execute()
    await database.updateTable('posts').set({ content: null, notes: '{not json, just how I write}' }).where('id', '=', noted).execute()

    resetLegacyContentMove()
    const items = (await queue.listPage({ limit: 500 })).items

    expect(items.find(item => item.id === parked)!.hasLink).toBe(true)
    const moved = await database.selectFrom('posts').select(['content', 'notes']).where('id', '=', parked).executeTakeFirstOrThrow()
    expect(moved.content).toBe(stored)
    expect(moved.notes).toBeNull()
    const kept = await database.selectFrom('posts').select(['content', 'notes']).where('id', '=', noted).executeTakeFirstOrThrow()
    expect(kept.notes).toBe('{not json, just how I write}')
    expect(kept.content).toBeNull()
  })
})
