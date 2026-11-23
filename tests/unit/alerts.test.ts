import type { ProviderPublisher } from '../../app/Services/Social/CrosspostService'
import type { CrosspostTargetResult } from '../../app/Support/Social/types'
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { alerts, AlertService } from '../../app/Services/AlertService'
import { CrosspostService } from '../../app/Services/Social/CrosspostService'
import { QueueService } from '../../app/Services/Social/QueueService'

const database = db as any

async function titlesFor(key: string): Promise<string[]> {
  return (await database.selectFrom('alerts').select(['title']).where('dedupe_key', 'like', `${key}%`).execute()).map((row: any) => String(row.title))
}

describe('raising an alert', () => {
  test('the same thing noticed twice is one alert, and one webhook call', async () => {
    const sent: Array<Record<string, unknown>> = []
    const service = new AlertService(async (_url, payload) => { sent.push(payload) }, () => 'https://hooks.example.com/x')
    const key = `test:${crypto.randomUUID()}`

    expect(await service.raise({ kind: 'post-failed', title: 'A post failed on Mastodon', body: 'Too long.', link: '/queue', key })).toBe(true)
    expect(await service.raise({ kind: 'post-failed', title: 'A post failed on Mastodon', key })).toBe(false)

    expect(await titlesFor(key)).toEqual(['A post failed on Mastodon'])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ text: 'A post failed on Mastodon\nToo long.', kind: 'post-failed', link: '/queue' })
  })

  test('a webhook that is down does not lose the alert or throw', async () => {
    const service = new AlertService(async () => { throw new Error('connection refused') }, () => 'https://hooks.example.com/x')
    const key = `test:${crypto.randomUUID()}`

    expect(await service.raise({ kind: 'post-missed', title: 'A scheduled post was not sent', key })).toBe(true)
    expect(await titlesFor(key)).toEqual(['A scheduled post was not sent'])
  })

  test('no webhook is called when none is configured', async () => {
    let calls = 0
    const service = new AlertService(async () => { calls++ }, () => '')
    await service.raise({ kind: 'post-failed', title: 'Quiet', key: `test:${crypto.randomUUID()}` })
    expect(calls).toBe(0)
  })

  test('reading clears the unread count', async () => {
    await alerts.raise({ kind: 'post-failed', title: 'Unread one', key: `test:${crypto.randomUUID()}` })
    expect((await alerts.list()).unread).toBeGreaterThan(0)

    await alerts.markRead()

    const after = await alerts.list()
    expect(after.unread).toBe(0)
    expect(after.alerts.every(alert => alert.read)).toBe(true)
  })
})

describe('what raises one', () => {
  function network(retry: CrosspostTargetResult['retry']): ProviderPublisher {
    return {
      async publishToPost(post): Promise<CrosspostTargetResult> {
        await database.insertInto('post_targets').values({ uuid: crypto.randomUUID(), provider: 'blog', status: 'failed', failure_reason: 'The network said no.', post_id: post.id }).execute()
        return { provider: 'blog', ok: false, error: 'The network said no.', target: 'blog', retry } as CrosspostTargetResult
      },
    }
  }
  const queueWith = (publisher: ProviderPublisher): QueueService => new QueueService(new CrosspostService({ blog: publisher } as never))

  test('a post that failed for good raises one; one that will be retried does not', async () => {
    const refused = queueWith(network({ kind: 'permanent' }))
    const first = (await refused.save({ text: 'refused for good', providers: ['blog'] })).postId
    await refused.publishNow(first)
    expect(await titlesFor(`post-failed:${first}:`)).toEqual(['A post failed on the blog'])

    const flaky = queueWith(network({ kind: 'transient' }))
    const second = (await flaky.save({ text: 'will be retried', providers: ['blog'] })).postId
    await flaky.publishNow(second)
    expect(await titlesFor(`post-failed:${second}:`)).toEqual([])
    await database.updateTable('post_targets').set({ next_attempt_at: null }).where('post_id', '=', second).execute()
  })

  test('a scheduled post held back as too late raises one', async () => {
    const queue = queueWith(network(undefined))
    const { postId } = await queue.save({ text: 'days late', providers: ['blog'], scheduledAt: new Date(Date.now() + 3_600_000).toISOString().slice(0, 19).replace('T', ' ') })
    const late = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')
    await database.updateTable('posts').set({ scheduled_at: late }).where('id', '=', postId).execute()

    await queue.publishDue(30)

    expect(await titlesFor(`post-set-aside:${postId}`)).toEqual(['A scheduled post was not sent'])
  })
})
