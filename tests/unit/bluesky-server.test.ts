import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { BlueskyApiError, BlueskyDriver, isBlueskySessionError } from '../../app/Services/Social/Drivers/BlueskyDriver'
import { DEFAULT_BLUESKY_SERVER, forgetBlueskyServers, resolveBlueskyDid, resolveBlueskyServer, resolvePdsOfDid } from '../../app/Support/Social/bluesky-server'
import { parseLinkPreview } from '../../app/Support/Social/link-preview'

/** A tiny network: a map of address to the text it answers with. */
function network(pages: Record<string, unknown>) {
  const asked: string[] = []
  const get = async (url: string): Promise<string | null> => {
    asked.push(url)
    const page = pages[url]
    return page === undefined ? null : typeof page === 'string' ? page : JSON.stringify(page)
  }
  return { get, asked }
}

function pdsDocument(id: string, endpoint: string, serviceId = '#atproto_pds') {
  return { id, service: [{ id: serviceId, type: 'AtprotoPersonalDataServer', serviceEndpoint: endpoint }] }
}

afterEach(() => forgetBlueskyServers())

describe('finding the server an account lives on', () => {
  test('a handle on its own server resolves to that server', async () => {
    const { get } = network({
      'https://sam.example.com/.well-known/atproto-did': 'did:plc:abc123\n',
      'https://plc.directory/did:plc:abc123': pdsDocument('did:plc:abc123', 'https://pds.example.com'),
    })
    expect(await resolveBlueskyServer('sam.example.com', get)).toBe('https://pds.example.com')
  })

  test('a handle with no well-known file falls back to the public resolver', async () => {
    const { get } = network({
      'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=sam.bsky.social': { did: 'did:plc:xyz' },
      'https://plc.directory/did:plc:xyz': pdsDocument('did:plc:xyz', 'https://morel.us-east.host.bsky.network'),
    })
    expect(await resolveBlueskyDid('@sam.bsky.social', get)).toBe('did:plc:xyz')
    expect(await resolveBlueskyServer('sam.bsky.social', get)).toBe('https://morel.us-east.host.bsky.network')
  })

  test('a did:web account is read from its own domain', async () => {
    const { get } = network({ 'https://id.example.org/.well-known/did.json': pdsDocument('did:web:id.example.org', 'https://pds.example.org/', 'did:web:id.example.org#atproto_pds') })
    expect(await resolvePdsOfDid('did:web:id.example.org', get)).toBe('https://pds.example.org')
  })

  test('an email, an unknown handle or a broken document falls back to the default', async () => {
    const { get, asked } = network({ 'https://plc.directory/did:plc:bad': pdsDocument('did:plc:bad', 'http://insecure.example.com') })
    expect(await resolveBlueskyServer('sam@example.com', get)).toBe(DEFAULT_BLUESKY_SERVER)
    expect(asked).toEqual([])
    expect(await resolveBlueskyServer('nobody.example.com', get)).toBe(DEFAULT_BLUESKY_SERVER)
    expect(await resolveBlueskyServer('did:plc:bad', get)).toBe(DEFAULT_BLUESKY_SERVER)
    expect(await resolveBlueskyServer('', get)).toBe(DEFAULT_BLUESKY_SERVER)
  })

  test('does not use a service from a DID document for another identity', async () => {
    const { get } = network({
      'https://plc.directory/did:plc:abc123': pdsDocument('did:plc:other', 'https://pds.example.com'),
    })
    expect(await resolvePdsOfDid('did:plc:abc123', get)).toBeNull()
  })

  test('rejects web DIDs with path segments and service URLs with a path prefix', async () => {
    const { get, asked } = network({
      'https://plc.directory/did:plc:abc123': pdsDocument('did:plc:abc123', 'https://pds.example.com/api'),
    })
    expect(await resolvePdsOfDid('did:web:id.example.org:users:alice', get)).toBeNull()
    expect(asked).toEqual([])
    expect(await resolvePdsOfDid('did:plc:abc123', get)).toBeNull()
  })

  test('retries a DID document lookup a minute after the fallback', async () => {
    const address = 'https://plc.directory/did:plc:abc123'
    const pages: Record<string, unknown> = {}
    const { get, asked } = network(pages)
    const timestamp = Date.now()
    const clock = spyOn(Date, 'now').mockReturnValue(timestamp)
    try {
      expect(await resolveBlueskyServer('did:plc:abc123', get)).toBe(DEFAULT_BLUESKY_SERVER)
      pages[address] = pdsDocument('did:plc:abc123', 'https://pds.example.com')
      clock.mockReturnValue(timestamp + 59_000)
      expect(await resolveBlueskyServer('did:plc:abc123', get)).toBe(DEFAULT_BLUESKY_SERVER)
      clock.mockReturnValue(timestamp + 60_000)
      expect(await resolveBlueskyServer('did:plc:abc123', get)).toBe('https://pds.example.com')
      expect(asked).toEqual([address, address])
    }
    finally {
      clock.mockRestore()
    }
  })

  test('the answer is remembered, not looked up on every request', async () => {
    const { get, asked } = network({ 'https://plc.directory/did:plc:abc123': pdsDocument('did:plc:abc123', 'https://pds.example.com') })
    await resolveBlueskyServer('did:plc:abc123', get)
    await resolveBlueskyServer('did:plc:abc123', get)
    expect(asked).toHaveLength(1)
  })
})

describe('the Bluesky driver', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })
  const identity = { handle: 'sam.example.com', did: 'did:plc:abc123', accessToken: 'jwt' }

  function mockPds(calls: Array<{ url: string, body: any }>): void {
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const url = String(input)
      if (url.includes('uploadBlob')) {
        calls.push({ url, body: init.body })
        return new Response(JSON.stringify({ blob: { $type: 'blob', ref: { $link: 'bafy' }, mimeType: 'image/png', size: 8 } }), { status: 200 })
      }
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ uri: 'at://did:plc:abc123/app.bsky.feed.post/3k', cid: 'cid1' }), { status: 200 })
    }) as typeof fetch
  }

  test('talks to the server it was made for', async () => {
    const calls: Array<{ url: string, body: any }> = []; mockPds(calls)
    await new BlueskyDriver({ service: 'https://pds.example.com' }).publish(identity, { text: 'hello', facets: [] })
    expect(calls[0]!.url).toBe('https://pds.example.com/xrpc/com.atproto.repo.createRecord')
  })

  test('300 emoji fit, though they are 600 UTF-16 units', async () => {
    const calls: Array<{ url: string, body: any }> = []; mockPds(calls)
    const driver = new BlueskyDriver()
    await expect(driver.publish(identity, { text: '🎉'.repeat(300), facets: [] })).resolves.toBeDefined()
    await expect(driver.publish(identity, { text: '🎉'.repeat(301), facets: [] })).rejects.toThrow('300 characters')
  })

  test('a link card goes out with its picture', async () => {
    const calls: Array<{ url: string, body: any }> = []; mockPds(calls)
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    await new BlueskyDriver().publish(identity, { text: 'read this', facets: [], langs: ['en'], external: { uri: 'https://example.com/a', title: 'A', thumb: { bytes: png, mimeType: 'image/png' } } })

    const record = calls.find(call => call.url.includes('createRecord'))!.body.record
    expect(record.embed.$type).toBe('app.bsky.embed.external')
    expect(record.embed.external.thumb.ref.$link).toBe('bafy')
    expect(record.langs).toEqual(['en'])
  })

  test('an attached image replaces the card, and a picture too large is left off', async () => {
    const calls: Array<{ url: string, body: any }> = []; mockPds(calls)
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    const driver = new BlueskyDriver()
    await driver.publish(identity, { text: 'both', facets: [], media: [{ bytes: png, mimeType: 'image/png', altText: 'a dot' }], external: { uri: 'https://example.com/a', title: 'A' } })
    expect(calls.find(call => call.url.includes('createRecord'))!.body.record.embed.$type).toBe('app.bsky.embed.images')

    calls.length = 0
    await driver.publish(identity, { text: 'big', facets: [], external: { uri: 'https://example.com/a', title: 'A', thumb: { bytes: new Uint8Array(1_000_001), mimeType: 'image/png' } } })
    expect(calls.some(call => call.url.includes('uploadBlob'))).toBe(false)
    expect(calls.find(call => call.url.includes('createRecord'))!.body.record.embed.external.thumb).toBeUndefined()
  })

  test('only a session problem counts as one: a rejected post does not', () => {
    expect(isBlueskySessionError(new BlueskyApiError('x', 401, ''))).toBe(true)
    expect(isBlueskySessionError(new BlueskyApiError('x', 400, JSON.stringify({ error: 'ExpiredToken' })))).toBe(true)
    expect(isBlueskySessionError(new BlueskyApiError('x', 400, JSON.stringify({ error: 'InvalidRequest', message: 'Record too long' })))).toBe(false)
    expect(isBlueskySessionError(new Error('fetch failed'))).toBe(false)
  })
})

describe('reading a link card from a page', () => {
  test('prefers Open Graph, and makes the image address absolute', () => {
    const html = '<html><head><title>Fallback</title><meta property="og:title" content="A &amp; B"><meta name="description" content="About it"><meta property="og:image" content="/img/card.png"></head></html>'
    expect(parseLinkPreview(html, new URL('https://www.example.com/post'))).toEqual({
      url: 'https://www.example.com/post',
      domain: 'example.com',
      title: 'A & B',
      description: 'About it',
      image: 'https://www.example.com/img/card.png',
    })
  })
})
