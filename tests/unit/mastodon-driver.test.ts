import { afterEach, describe, expect, test } from 'bun:test'
import { MastodonApiError, MastodonDriver, mastodonIdempotencyKey, MastodonPublishingDriver, normalizeInstance } from '../../app/Services/Social/Drivers/MastodonDriver'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const creds = { handle: '@glenn@mastodon.social', did: 'https://mastodon.social', accessToken: 'tok' }

interface Captured { url: string, method: string, body: any, headers: any }

function mockApi(captured: Captured[], overrides: (url: string) => Response | null = () => null): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    const over = overrides(url)
    if (over) { captured.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers }); return over }

    if (url.includes('verify_credentials')) {
      captured.push({ url, method: 'GET', body: undefined, headers: init.headers })
      return new Response(JSON.stringify({ id: '42', username: 'glenn', display_name: 'Glenn', url: 'https://mastodon.social/@glenn' }), { status: 200 })
    }
    if (url.includes('/api/v2/media')) {
      captured.push({ url, method: 'POST', body: init.body, headers: init.headers })
      return new Response(JSON.stringify({ id: `media${captured.length}` }), { status: 200 })
    }
    // statuses
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    captured.push({ url, method: init.method, body, headers: init.headers })
    return new Response(JSON.stringify({ id: `sid${captured.length}`, url: `https://mastodon.social/@glenn/sid${captured.length}` }), { status: 200 })
  }) as typeof fetch
}

describe('normalizeInstance', () => {
  test('adds https and strips trailing slash / path', () => {
    expect(normalizeInstance('mastodon.social')).toBe('https://mastodon.social')
    expect(normalizeInstance('https://fosstodon.org/')).toBe('https://fosstodon.org')
    expect(normalizeInstance('https://hachyderm.io/home')).toBe('https://hachyderm.io')
  })
  test('rejects empty', () => {
    expect(() => normalizeInstance('')).toThrow(/required/i)
  })
})

describe('MastodonPublishingDriver', () => {
  test('verifyCredentials returns the account', async () => {
    const cap: Captured[] = []; mockApi(cap)
    const driver = new MastodonPublishingDriver()
    const account = await driver.verifyCredentials(creds)
    expect(cap[0]!.url).toContain('/api/v1/accounts/verify_credentials')
    expect(account).toEqual({ accountId: '42', username: 'glenn', displayName: 'Glenn', url: 'https://mastodon.social/@glenn' })
  })

  test('publishes a plain status', async () => {
    const cap: Captured[] = []; mockApi(cap)
    const driver = new MastodonPublishingDriver()
    const result = await driver.publish(creds, { text: 'hello fediverse' })
    const post = cap.find(c => c.url.endsWith('/api/v1/statuses'))
    expect(post?.body.status).toBe('hello fediverse')
    expect(post?.body.visibility).toBe('public')
    expect(post?.body.media_ids).toBeUndefined()
    expect(result.uri).toBe(result.cid as string) // status id doubles as both
    expect(result.url).toContain('mastodon.social/@glenn')
  })

  test('uploads image bytes and attaches media_ids', async () => {
    const cap: Captured[] = []; mockApi(cap)
    const driver = new MastodonPublishingDriver()
    await driver.publish(creds, { text: 'photo', media: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', altText: 'chart' }] })
    const upload = cap.find(c => c.url.includes('/api/v2/media'))
    expect(upload).toBeDefined()
    const post = cap.find(c => c.url.endsWith('/api/v1/statuses'))
    expect(post?.body.media_ids).toHaveLength(1)
  })

  test('threads via in_reply_to_id from reply.parent.uri', async () => {
    const cap: Captured[] = []; mockApi(cap)
    const driver = new MastodonPublishingDriver()
    await driver.publish(creds, {
      text: 'second toot',
      reply: { root: { uri: 'sid1', cid: 'sid1' }, parent: { uri: 'sid1', cid: 'sid1' } },
    })
    const post = cap.find(c => c.url.endsWith('/api/v1/statuses'))
    expect(post?.body.in_reply_to_id).toBe('sid1')
  })

  test('rejects text over the character limit before calling the API', async () => {
    const cap: Captured[] = []; mockApi(cap)
    const driver = new MastodonPublishingDriver()
    await expect(driver.publish(creds, { text: 'x'.repeat(501) })).rejects.toThrow(/500 characters/)
    // The instance is asked for its limit first; nothing is posted.
    expect(cap.filter(call => call.url.endsWith('/api/v1/statuses'))).toHaveLength(0)
  })

  test('surfaces API errors as MastodonApiError with status', async () => {
    const cap: Captured[] = []
    mockApi(cap, url => url.endsWith('/api/v1/statuses') ? new Response('{"error":"Unauthorized"}', { status: 401 }) : null)
    const driver = new MastodonPublishingDriver()
    let caught: unknown
    await driver.publish(creds, { text: 'hi' }).catch((e) => { caught = e })
    expect(caught).toBeInstanceOf(MastodonApiError)
    expect((caught as MastodonApiError).status).toBe(401)
    expect((caught as MastodonApiError).isAuthError).toBe(true)
  })
})

describe('MastodonDriver, what Postline adds', () => {
  const instance = (limits: Record<string, unknown> | null) => (url: string): Response | null => {
    if (!url.includes('/api/v2/instance')) return null
    return limits ? new Response(JSON.stringify({ configuration: { statuses: limits } }), { status: 200 }) : new Response('nope', { status: 404 })
  }

  test('reads the instance limit, once, and falls back to 500', async () => {
    const cap: Captured[] = []; mockApi(cap, instance({ max_characters: 5000, characters_reserved_per_url: 23, max_media_attachments: 4 }))
    const driver = new MastodonDriver()

    expect((await driver.instanceLimits(creds)).characters).toBe(5000)
    await driver.instanceLimits(creds)
    expect(cap.filter(call => call.url.includes('/api/v2/instance'))).toHaveLength(1)

    mockApi([], instance(null))
    expect((await new MastodonDriver().instanceLimits(creds)).characters).toBe(500)
  })

  test('a publish carries its idempotency key, so a retry cannot post twice', async () => {
    const cap: Captured[] = []; mockApi(cap, instance(null))
    const key = mastodonIdempotencyKey(7, 3, 'hello fediverse')
    await new MastodonDriver().publish(creds, { text: 'hello fediverse' }, { idempotencyKey: key })

    const post = cap.find(call => call.url.endsWith('/api/v1/statuses'))!
    // Header names are case-insensitive; read it either way.
    expect(new Headers(post.headers).get('Idempotency-Key')).toBe(key)
  })

  test('the key is the same for a retry and different once the text changes', () => {
    expect(mastodonIdempotencyKey(7, 3, 'same text')).toBe(mastodonIdempotencyKey(7, 3, 'same text'))
    expect(mastodonIdempotencyKey(7, 3, 'same text')).not.toBe(mastodonIdempotencyKey(7, 3, 'edited text'))
    expect(mastodonIdempotencyKey(7, 3, 'same text')).not.toBe(mastodonIdempotencyKey(7, 4, 'same text'))
    expect(mastodonIdempotencyKey(7, 3, 'same text')).not.toBe(mastodonIdempotencyKey(8, 3, 'same text'))
  })

  test('visibility, a content warning and a language are sent when given', async () => {
    const cap: Captured[] = []; mockApi(cap, instance(null))
    await new MastodonDriver().publish(creds, { text: 'spoilers' }, { visibility: 'unlisted', spoilerText: 'Film ending', language: 'en' })

    const post = cap.find(call => call.url.endsWith('/api/v1/statuses'))!
    expect(post.body).toMatchObject({ status: 'spoilers', visibility: 'unlisted', spoiler_text: 'Film ending', language: 'en' })
  })

  test('four images at most, each with its alt text', async () => {
    const cap: Captured[] = []; mockApi(cap, instance(null))
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    const media = Array.from({ length: 6 }, (_, index) => ({ bytes: png, mimeType: 'image/png', altText: `picture ${index}` }))
    await new MastodonDriver().publish(creds, { text: 'gallery', media })

    expect(cap.filter(call => call.url.includes('/api/v2/media'))).toHaveLength(4)
    expect(cap.find(call => call.url.endsWith('/api/v1/statuses'))!.body.media_ids).toHaveLength(4)
  })

  test('a reply is sent to its parent', async () => {
    const cap: Captured[] = []; mockApi(cap, instance(null))
    const ref = { uri: '111', cid: '111' }
    await new MastodonDriver().publish(creds, { text: 'second', reply: { root: ref, parent: ref } })
    expect(cap.find(call => call.url.endsWith('/api/v1/statuses'))!.body.in_reply_to_id).toBe('111')
  })
})
