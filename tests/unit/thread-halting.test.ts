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
