import { afterEach, describe, expect, test } from 'bun:test'
import { ThreadsApiError, ThreadsDriver } from '../../app/Services/Social/Drivers/ThreadsDriver'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Captured { url: string, method: string }

function mockThreadsTokenApi(captured: Captured[], overrides: (url: string) => Response | null = () => null): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    const over = overrides(url)
    if (over) { captured.push({ url, method: init.method || 'GET' }); return over }

    if (url.includes('th_exchange_token')) {
      captured.push({ url, method: init.method || 'GET' })
      return new Response(JSON.stringify({ access_token: 'LONG_LIVED', token_type: 'bearer', expires_in: 5184000 }), { status: 200 })
    }
    if (url.includes('th_refresh_token')) {
      captured.push({ url, method: init.method || 'GET' })
      return new Response(JSON.stringify({ access_token: 'REFRESHED', token_type: 'bearer', expires_in: 5184000 }), { status: 200 })
    }
    captured.push({ url, method: init.method || 'GET' })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}

describe('ThreadsDriver token lifecycle', () => {
  test('exchangeLongLivedToken swaps a short-lived token for a ~60-day one', async () => {
    const cap: Captured[] = []; mockThreadsTokenApi(cap)
    const driver = new ThreadsDriver()
    const result = await driver.exchangeLongLivedToken('secret-xyz', 'short-token')

    expect(result).toEqual({ accessToken: 'LONG_LIVED', expiresIn: 5184000 })
    const call = cap.find(c => c.url.includes('th_exchange_token'))
    expect(call?.url).toContain('graph.threads.net/access_token')
    expect(call?.url).toContain('client_secret=secret-xyz')
    expect(call?.url).toContain('access_token=short-token')
  })

  test('refreshLongLivedToken extends an existing long-lived token', async () => {
    const cap: Captured[] = []; mockThreadsTokenApi(cap)
    const driver = new ThreadsDriver()
    const result = await driver.refreshLongLivedToken('long-token')

    expect(result).toEqual({ accessToken: 'REFRESHED', expiresIn: 5184000 })
    const call = cap.find(c => c.url.includes('th_refresh_token'))
    expect(call?.url).toContain('graph.threads.net/refresh_access_token')
    expect(call?.url).toContain('access_token=long-token')
  })

  test('surfaces a token error as ThreadsApiError with status', async () => {
    const cap: Captured[] = []
    mockThreadsTokenApi(cap, () => new Response(JSON.stringify({ error: { message: 'bad token' } }), { status: 400 }))
    const driver = new ThreadsDriver()
    let caught: unknown
    await driver.refreshLongLivedToken('nope').catch((e) => { caught = e })
    expect(caught).toBeInstanceOf(ThreadsApiError)
    expect((caught as ThreadsApiError).status).toBe(400)
  })
})

describe('ThreadsDriver publishing a thread', () => {
  function mockGraph(bodies: string[]): void {
    let next = 100
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const url = String(input)
      if (init.method === 'POST') bodies.push(`${new URL(url).pathname.split('/').pop()}?${String(init.body)}`)
      if (url.includes('fields=permalink')) return new Response(JSON.stringify({ permalink: 'https://www.threads.net/@me/post/abc' }), { status: 200 })
      return new Response(JSON.stringify({ id: String(next++) }), { status: 200 })
    }) as typeof fetch
  }

  const identity = { handle: 'me', did: '42', accessToken: 'token' }

  test('the first segment is a plain post and returns what the next one replies to', async () => {
    const bodies: string[] = []; mockGraph(bodies)
    const published = await new ThreadsDriver().publish(identity, { text: 'One' })

    expect(bodies[0]).toContain('media_type=TEXT')
    expect(bodies[0]).not.toContain('reply_to_id')
    expect(published.uri).toBe('101')
    expect(published.cid).toBe('101')
    expect(published.url).toBe('https://www.threads.net/@me/post/abc')
  })

  test('a later segment is sent as a reply to the one before it', async () => {
    const bodies: string[] = []; mockGraph(bodies)
    const ref = { uri: '101', cid: '101' }
    await new ThreadsDriver().publish(identity, { text: 'Two', reply: { root: ref, parent: ref } })

    expect(bodies[0]).toContain('threads?')
    expect(bodies[0]).toContain('reply_to_id=101')
  })

  test('500 emoji fit, though they are 1,000 UTF-16 units', async () => {
    const bodies: string[] = []; mockGraph(bodies)
    await expect(new ThreadsDriver().publish(identity, { text: '🎉'.repeat(500) })).resolves.toBeDefined()
    await expect(new ThreadsDriver().publish(identity, { text: '🎉'.repeat(501) })).rejects.toThrow('500 characters')
  })
})
