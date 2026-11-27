import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'
import { networkApps } from '../../app/Services/NetworkAppService'
import { syncEngagement } from '../../app/Services/Social/EngagementService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { twitterReadUsage, withTwitterReadBudget } from '../../app/Services/Social/TwitterReadBudget'
import { twitter } from '../../app/Services/Social/TwitterService'
import { upsertIdentityRow } from '../../app/Services/Social/identities'

const savedLimit = Bun.env.TWITTER_DAILY_READ_BUDGET_USD
const realFetch = globalThis.fetch

beforeEach(async () => {
  Bun.env.TWITTER_DAILY_READ_BUDGET_USD = '0.020'
  await db.unsafe('DELETE FROM twitter_read_usage')
})

afterEach(async () => {
  globalThis.fetch = realFetch
  if (savedLimit === undefined) delete Bun.env.TWITTER_DAILY_READ_BUDGET_USD
  else Bun.env.TWITTER_DAILY_READ_BUDGET_USD = savedLimit
  await db.unsafe('DELETE FROM twitter_read_usage')
})

describe('X API read budget', () => {
  test('reserves before dispatch, shares the cap, and returns unused allowance', async () => {
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<{ value: string, estimatedMicros: number }>()
    const first = withTwitterReadBudget(15_000, async () => {
      started.resolve()
      return await response.promise
    })
    await started.promise
    let dispatched = 0
    const second = () => withTwitterReadBudget(10_000, async () => {
      dispatched++
      return { value: 'second', estimatedMicros: 10_000 }
    })
    try {
      expect(await twitterReadUsage()).toMatchObject({ estimatedUsd: 0.015, limitUsd: 0.02 })
      await expect(second()).rejects.toMatchObject({ code: 'twitter_read_budget' })
      expect(dispatched).toBe(0)
    }
    finally {
      response.resolve({ value: 'first', estimatedMicros: 5_000 })
    }
    expect(await first).toBe('first')
    expect(await second()).toBe('second')
    expect(await twitterReadUsage()).toMatchObject({ estimatedUsd: 0.015, limitUsd: 0.02 })
  })

  test('keeps the reservation when the provider response is lost', async () => {
    await expect(withTwitterReadBudget(20_000, async () => {
      throw new Error('connection ended before a response arrived')
    })).rejects.toThrow('connection ended')
    expect(await twitterReadUsage()).toMatchObject({ estimatedUsd: 0.02, limitUsd: 0.02 })
  })

  test('does not send a paid read when reads are disabled', async () => {
    Bun.env.TWITTER_DAILY_READ_BUDGET_USD = '0'
    let dispatched = false
    await expect(withTwitterReadBudget(5_000, async () => {
      dispatched = true
      return { value: null, estimatedMicros: 0 }
    })).rejects.toMatchObject({ code: 'twitter_read_budget' })
    expect(dispatched).toBe(false)
  })

  test('reserves the full cost of an explicit engagement refresh and keeps unreported counts', async () => {
    const identity = await upsertIdentityRow('twitter', { externalId: '9988' }, {
      handle: 'engagement-budget-fixture',
      external_id: '9988',
      auth_status: 'connected',
      access_token: 'metrics-test-token',
    })
    const identityId = Number(identity.id)
    const posts: number[] = []
    const calls: string[] = []

    async function published(remoteId: string, previous: string | null = null) {
      const { postId } = await postQueue.save({ text: 'X engagement fixture ' + remoteId, providers: [`twitter:${identityId}`] })
      posts.push(postId)
      await db.unsafe('UPDATE post_targets SET status = ?, remote_uri = ?, metrics = ? WHERE post_id = ?', ['published', remoteId, previous, postId])
      return postId
    }

    async function counts(postId: number) {
      const [target] = await db.unsafe('SELECT metrics FROM post_targets WHERE post_id = ?', [postId])
      return JSON.parse(String(target?.metrics ?? 'null'))
    }

    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      calls.push(url.pathname)
      expect(url.pathname).toBe('/2/tweets')
      expect(url.searchParams.get('ids')?.split(',').sort()).toEqual(['10', '20'])
      expect(url.searchParams.get('tweet.fields')).toBe('public_metrics')
      expect(request.headers.get('authorization')).toBe('Bearer metrics-test-token')
      expect(await twitterReadUsage()).toMatchObject({ estimatedUsd: 0.01 })
      return Response.json({ data: [{ id: '10', public_metrics: { like_count: 3, reply_count: 0 } }, { id: '20' }] })
    }) as typeof fetch

    try {
      const measured = await published('10')
      const unreported = await published('20', '{"likes":8}')
      Bun.env.TWITTER_DAILY_READ_BUDGET_USD = '0.015'
      await networkApps.save('twitter', { clientId: 'test-client', clientSecret: 'test-secret', engagementMetrics: false })
      expect(await twitter.syncMetrics()).toEqual({ synced: 0 })
      await networkApps.save('twitter', { clientId: 'test-client', engagementMetrics: true })
      await syncEngagement()
      expect(calls).toEqual([])

      expect(await syncEngagement({ includeTwitter: true })).toMatchObject({ synced: 1, errors: [] })
      expect(await counts(measured)).toMatchObject({ likes: 3, replies: 0 })
      expect(await counts(unreported)).toEqual({ likes: 8 })
      expect(await syncEngagement({ includeTwitter: true })).toMatchObject({
        synced: 0,
        errors: [{ provider: 'twitter', explanation: expect.stringContaining('daily read budget') }],
      })
      expect(calls).toEqual(['/2/tweets'])
      expect(await twitterReadUsage()).toMatchObject({ estimatedUsd: 0.01 })
    }
    finally {
      for (const postId of posts) {
        await db.unsafe('DELETE FROM post_targets WHERE post_id = ?', [postId])
        await db.unsafe('DELETE FROM posts WHERE id = ?', [postId])
      }
      await db.unsafe('DELETE FROM social_identities WHERE id = ?', [identityId])
      await networkApps.clear('twitter')
    }
  })

  test('resumes Listening from its stored bounds and advances after the whole window', async () => {
    Bun.env.TWITTER_DAILY_READ_BUDGET_USD = '2'
    const identity = await upsertIdentityRow('twitter', { externalId: '9999' }, {
      provider: 'twitter',
      handle: 'read-budget-fixture',
      external_id: '9999',
      auth_status: 'connected',
      access_token: 'test-only-token',
    })
    const rule = { name: 'X read fixture', keywords: ['postline'], providers: ['twitter'] }
    const { id } = await keywordMonitoring.save(0, rule) as { id: number }
    const requested: URLSearchParams[] = []
    const replies = [
      { data: [{ id: '30', text: 'Postline' }], meta: { newest_id: '30', oldest_id: '30', next_token: 'next' } },
      { data: [{ id: '20', text: 'Postline' }], meta: { newest_id: '20', oldest_id: '20' } },
      { meta: { result_count: 0 } },
      { meta: { result_count: 0 } },
    ]
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input)
      expect(url.href).toStartWith('https://api.x.com/2/tweets/search/recent?')
      requested.push(url.searchParams)
      return Response.json(replies.shift())
    }) as typeof fetch
    try {
      expect(await keywordMonitoring.scan(id)).toMatchObject({ created: 1, errors: [] })
      expect(await keywordMonitoring.scan(id)).toMatchObject({ created: 1, errors: [] })
      expect(await keywordMonitoring.scan(id)).toMatchObject({ created: 0, errors: [] })
      expect(requested[0]?.has('since_id')).toBe(false)
      expect(requested[1]?.get('until_id')).toBe('30')
      expect(requested[2]?.get('since_id')).toBe('30')
      expect(requested[2]?.has('until_id')).toBe(false)
      expect(await twitterReadUsage()).toMatchObject({ estimatedUsd: 0.01, limitUsd: 2 })

      await keywordMonitoring.save(id, { ...rule, keywords: ['stacks'] })
      expect(await keywordMonitoring.scan(id)).toMatchObject({ created: 0, errors: [] })
      expect(requested[3]?.has('since_id')).toBe(false)
    }
    finally {
      await keywordMonitoring.remove(id)
      await db.unsafe('DELETE FROM alerts WHERE dedupe_key LIKE ?', [`keyword:${id}:%`])
      await db.unsafe('DELETE FROM social_identities WHERE id = ?', [Number(identity.id)])
    }
  })

  test('requests the image upload scope through Postline consent', async () => {
    try {
      await networkApps.save('twitter', { clientId: 'test-client', clientSecret: 'test-secret' })
      const scopes = new URL((await twitter.prepareAuthorization()).url).searchParams.get('scope')?.split(' ')
      expect(scopes).toContain('media.write')
    }
    finally {
      await networkApps.clear('twitter')
    }
  })
})
