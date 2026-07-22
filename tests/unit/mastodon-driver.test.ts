import { afterEach, describe, expect, test } from 'bun:test'
import { MastodonApiError, MastodonPublishingDriver, normalizeInstance } from '../../app/Services/Social/Drivers/MastodonDriver'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const creds = { instance: 'https://mastodon.social', accessToken: 'tok' }

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
    expect(cap[0].url).toContain('/api/v1/accounts/verify_credentials')
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
    expect(result.uri).toBe(result.cid) // status id doubles as both
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
    expect(cap).toHaveLength(0)
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
