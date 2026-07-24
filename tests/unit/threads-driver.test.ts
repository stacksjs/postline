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
