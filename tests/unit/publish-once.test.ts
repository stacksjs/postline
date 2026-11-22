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
import { existsSync } from 'node:fs'
import process from 'node:process'
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { CrosspostService } from '../../app/Services/Social/CrosspostService'
import { AlreadyPublishingError, QueueService, STRANDED_REASON } from '../../app/Services/Social/QueueService'
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
    const stored = JSON.parse((await database.selectFrom('posts').selectAll().where('id', '=', postId).executeTakeFirstOrThrow()).notes || '{}')
    const path = `${process.cwd()}/storage/app/postline-media/${stored.media[0].path}`
    expect(await edit()).toBe(true)
    expect(existsSync(path)).toBe(true)

    await queueWith({ blog: fakeNetwork('blog'), mastodon: fakeNetwork('mastodon') }).publishNow(postId)
    expect(existsSync(path)).toBe(false)
  })
})
