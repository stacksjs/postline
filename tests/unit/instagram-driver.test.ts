import { afterEach, describe, expect, test } from 'bun:test'
import { InstagramApiError, InstagramDriver } from '../../app/Services/Social/Drivers/InstagramDriver'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Captured { url: string, method: string }

function mockGraphApi(captured: Captured[], overrides: (url: string) => Response | null = () => null): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    const over = overrides(url)
    if (over) { captured.push({ url, method: init.method || 'GET' }); return over }

    if (url.includes('fb_exchange_token')) {
      captured.push({ url, method: init.method || 'GET' })
      return new Response(JSON.stringify({ access_token: 'LONG_LIVED_USER', token_type: 'bearer', expires_in: 5184000 }), { status: 200 })
    }
    captured.push({ url, method: init.method || 'GET' })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}

describe('InstagramDriver.exchangeLongLivedUserToken', () => {
  test('exchanges a short-lived user token for a long-lived one', async () => {
    const cap: Captured[] = []; mockGraphApi(cap)
    const driver = new InstagramDriver()
    const result = await driver.exchangeLongLivedUserToken('client-1', 'secret-2', 'short-user-token')

    expect(result).toEqual({ accessToken: 'LONG_LIVED_USER', expiresIn: 5184000 })
    const call = cap.find(c => c.url.includes('fb_exchange_token'))
    expect(call?.url).toContain('graph.facebook.com')
    expect(call?.url).toContain('/oauth/access_token')
    expect(call?.url).toContain('client_id=client-1')
    expect(call?.url).toContain('fb_exchange_token=short-user-token')
  })

  test('surfaces a Graph error as InstagramApiError', async () => {
    const cap: Captured[] = []
    mockGraphApi(cap, () => new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 400 }))
    const driver = new InstagramDriver()
    let caught: unknown
    await driver.exchangeLongLivedUserToken('c', 's', 'bad').catch((e) => { caught = e })
    expect(caught).toBeInstanceOf(InstagramApiError)
    expect((caught as InstagramApiError).status).toBe(400)
  })
})
