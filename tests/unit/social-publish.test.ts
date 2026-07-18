import { afterEach, describe, expect, test } from 'bun:test'
import { BlueskyPublishingDriver } from '../../storage/framework/core/socials/src/drivers/bluesky'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

interface CapturedRequest {
  url: string
  body: any
}

function mockBlueskyApi(captured: CapturedRequest[]): void {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    captured.push({ url, body })
    return new Response(JSON.stringify({
      uri: `at://did:plc:test/app.bsky.feed.post/rec${captured.length}`,
      cid: `cid${captured.length}`,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const identity = {
  handle: 'tester.bsky.social',
  did: 'did:plc:test',
  accessToken: 'jwt-token',
}

describe('BlueskyPublishingDriver.publish', () => {
  test('creates a plain post record without reply refs', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    const result = await driver.publish(identity, { text: 'hello world' })

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toContain('/xrpc/com.atproto.repo.createRecord')
    expect(captured[0].body.record.text).toBe('hello world')
    expect(captured[0].body.record.reply).toBeUndefined()
    expect(result.uri).toBe('at://did:plc:test/app.bsky.feed.post/rec1')
    expect(result.cid).toBe('cid1')
  })

  test('threads a reply via root/parent refs on the record', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const reply = {
      root: { uri: 'at://did:plc:test/app.bsky.feed.post/root', cid: 'cid-root' },
      parent: { uri: 'at://did:plc:test/app.bsky.feed.post/parent', cid: 'cid-parent' },
    }

    const driver = new BlueskyPublishingDriver()
    await driver.publish(identity, { text: 'second segment', reply })

    expect(captured[0].body.record.reply).toEqual(reply)
  })

  test('attaches an external link card when provided', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    await driver.publish(identity, {
      text: 'with card',
      external: { uri: 'https://example.com', title: 'Example', description: 'Desc' },
    })

    expect(captured[0].body.record.embed).toEqual({
      $type: 'app.bsky.embed.external',
      external: { uri: 'https://example.com', title: 'Example', description: 'Desc' },
    })
  })

  test('rejects posts over the character limit without hitting the API', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    await expect(driver.publish(identity, { text: 'x'.repeat(301) })).rejects.toThrow(/300 characters/)
    expect(captured).toHaveLength(0)
  })

  test('rejects when the identity has no access token', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    await expect(driver.publish({ handle: 'tester.bsky.social' }, { text: 'hi' })).rejects.toThrow(/access token/)
    expect(captured).toHaveLength(0)
  })
})
