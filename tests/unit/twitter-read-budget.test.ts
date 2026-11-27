import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'
import { networkApps } from '../../app/Services/NetworkAppService'
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
      const scopes = new URL(await twitter.getAuthUrl()).searchParams.get('scope')?.split(' ')
      expect(scopes).toContain('media.write')
    }
    finally {
      await networkApps.clear('twitter')
    }
  })
})
