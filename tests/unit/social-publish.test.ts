import { afterEach, describe, expect, test } from 'bun:test'
import { BlueskyPublishingDriver, detectFacetCandidates } from '../../storage/framework/core/socials/src/drivers/bluesky'

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

    if (url.includes('resolveHandle')) {
      captured.push({ url, body: undefined })
      const handle = new URL(url).searchParams.get('handle')
      if (handle === 'ghost.example.com')
        return new Response(JSON.stringify({ error: 'not found' }), { status: 400 })
      return new Response(JSON.stringify({ did: `did:plc:${handle}` }), { status: 200 })
    }

    if (url.includes('uploadBlob')) {
      captured.push({ url, body: { mimeType: init?.headers?.['content-type'], size: init?.body?.length } })
      return new Response(JSON.stringify({
        blob: { $type: 'blob', ref: { $link: `blob${captured.length}` }, mimeType: init?.headers?.['content-type'], size: init?.body?.length },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    captured.push({ url, body })
    return new Response(JSON.stringify({
      uri: `at://did:plc:test/app.bsky.feed.post/rec${captured.length}`,
      cid: `cid${captured.length}`,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

function lastRecord(captured: CapturedRequest[]): any {
  return captured.find(request => request.url.includes('createRecord'))?.body?.record
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

  test('auto-builds link, tag, and mention facets with resolved DIDs', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    await driver.publish(identity, { text: 'Read https://example.com/x. Thanks @alice.bsky.social #stacks' })

    const record = lastRecord(captured)
    expect(record.facets).toHaveLength(3)
    const features = record.facets.map((facet: any) => facet.features[0])
    expect(features[0]).toEqual({ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/x' })
    expect(features[1]).toEqual({ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice.bsky.social' })
    expect(features[2]).toEqual({ $type: 'app.bsky.richtext.facet#tag', tag: 'stacks' })
  })

  test('drops mention facets whose handle does not resolve', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    await driver.publish(identity, { text: 'cc @ghost.example.com' })

    expect(lastRecord(captured).facets).toBeUndefined()
  })

  test('uploads image bytes and embeds them, overriding the link card', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    await driver.publish(identity, {
      text: 'photo time',
      external: { uri: 'https://example.com', title: 'Example' },
      media: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', altText: 'a chart' }],
    })

    const upload = captured.find(request => request.url.includes('uploadBlob'))
    expect(upload?.body.mimeType).toBe('image/png')
    const record = lastRecord(captured)
    expect(record.embed.$type).toBe('app.bsky.embed.images')
    expect(record.embed.images[0].alt).toBe('a chart')
    expect(record.embed.images[0].image.ref.$link).toBeDefined()
  })

  test('postMetrics fetches engagement counts for up to 25 URIs', async () => {
    const captured: CapturedRequest[] = []
    globalThis.fetch = (async (input: any) => {
      const url = new URL(String(input))
      captured.push({ url: String(input), body: undefined })
      const uris = url.searchParams.getAll('uris')
      return new Response(JSON.stringify({
        // Second post "deleted" upstream — absent from the response.
        posts: uris.slice(0, 1).map(uri => ({ uri, likeCount: 7, repostCount: 2, replyCount: 3 })),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const driver = new BlueskyPublishingDriver()
    const metrics = await driver.postMetrics(identity, [
      'at://did:plc:test/app.bsky.feed.post/aaa',
      'at://did:plc:test/app.bsky.feed.post/bbb',
    ])

    expect(captured[0].url).toContain('app.bsky.feed.getPosts')
    expect(metrics).toEqual([
      { uri: 'at://did:plc:test/app.bsky.feed.post/aaa', likeCount: 7, repostCount: 2, replyCount: 3 },
    ])
  })

  test('postMetrics returns empty without hitting the API for no URIs', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    expect(await driver.postMetrics(identity, [])).toEqual([])
    expect(captured).toHaveLength(0)
  })

  test('uploadBlob rejects images over 1MB', async () => {
    const captured: CapturedRequest[] = []
    mockBlueskyApi(captured)

    const driver = new BlueskyPublishingDriver()
    await expect(driver.uploadBlob(identity, new Uint8Array(1_000_001), 'image/png')).rejects.toThrow(/1MB/)
    expect(captured).toHaveLength(0)
  })
})

describe('detectFacetCandidates', () => {
  test('computes UTF-8 byte offsets, not character offsets', () => {
    const text = '🦋 fly to https://bsky.app now'
    const [link] = detectFacetCandidates(text)
    // '🦋 fly to ' is 4 (emoji) + 8 = 12 bytes
    expect(link.byteStart).toBe(12)
    expect(link.byteEnd).toBe(12 + 'https://bsky.app'.length)
    expect(link.value).toBe('https://bsky.app')
  })

  test('trims trailing punctuation from links', () => {
    const [link] = detectFacetCandidates('see https://example.com/docs.')
    expect(link.value).toBe('https://example.com/docs')
  })

  test('skips numeric-only hashtags and tags inside links', () => {
    const candidates = detectFacetCandidates('#2024 https://example.com/#anchor #real')
    expect(candidates.map(candidate => `${candidate.type}:${candidate.value}`)).toEqual([
      'link:https://example.com/#anchor',
      'tag:real',
    ])
  })

  test('mentions require a domain-shaped handle', () => {
    const candidates = detectFacetCandidates('hey @nodot and @real.handle.social')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ type: 'mention', value: 'real.handle.social' })
  })
})
