/**
 * A Listening scan that finds new mentions raises one alert (#112), so a
 * match reaches the owner without the Listening page open.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'

const database = db as any
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function blueskyFinds(posts: Array<{ id: string, text: string }>): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith('https://api.bsky.app/')) throw new Error(`unexpected fetch ${url}`)
    return Response.json({
      posts: posts.map(post => ({
        uri: `at://did:plc:writer/app.bsky.feed.post/${post.id}`,
        author: { handle: 'writer.bsky.social', displayName: 'Writer' },
        record: { text: post.text, createdAt: '2026-11-20T10:00:00.000Z' },
      })),
    })
  }) as typeof fetch
}

async function alertsFor(monitorId: number): Promise<Array<{ title: string, kind: string, link: string }>> {
  return await database.selectFrom('alerts').select(['title', 'kind', 'link']).where('dedupe_key', 'like', `keyword:${monitorId}:%`).execute()
}

describe('keyword alerts', () => {
  test('new mentions raise one alert per scan, and a scan with nothing new raises none', async () => {
    const monitor = await keywordMonitoring.save(0, { name: 'Postline', keywords: ['postline'], providers: ['bluesky'] }) as { id: number }
    const id = Number(monitor.id)

    blueskyFinds([{ id: 'a1', text: 'Trying postline today' }, { id: 'a2', text: 'postline scheduled my week' }])
    await keywordMonitoring.scan(id)
    const raised = await alertsFor(id)
    expect(raised).toHaveLength(1)
    expect(raised[0]).toMatchObject({ kind: 'keyword-match', title: '2 new mentions of Postline', link: '/listening' })

    // The same posts again: nothing new, nothing raised.
    await keywordMonitoring.scan(id)
    expect(await alertsFor(id)).toHaveLength(1)

    blueskyFinds([{ id: 'a3', text: 'another postline post' }])
    await keywordMonitoring.scan(id)
    expect((await alertsFor(id)).map(alert => alert.title).sort()).toEqual(['2 new mentions of Postline', 'New mention of Postline'])
  })
})
