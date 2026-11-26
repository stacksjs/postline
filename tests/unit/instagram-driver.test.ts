import { afterEach, describe, expect, test } from 'bun:test'
import { networkApps } from '../../app/Services/NetworkAppService'
import { InstagramApiError, InstagramDriver } from '../../app/Services/Social/Drivers/InstagramDriver'
import { InstagramService } from '../../app/Services/Social/InstagramService'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Captured { url: string, method: string }

function mockGraphApi(captured: Captured[], overrides: (url: string) => Response | null = () => null): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    // The framework sends token requests as a form body, which keeps the client
    // secret out of the address; reading the body with the address lets the
    // assertions below check the parameters wherever they travel.
    const url = init.body && String(init.body).includes('=') && !String(input).includes('?') ? `${String(input)}?${String(init.body)}` : String(input)
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

describe('Instagram connection', () => {
  afterEach(async () => { await networkApps.clear('instagram') })

  test('rejects the connection when Facebook cannot issue a long-lived token', async () => {
    await networkApps.save('instagram', { clientId: 'test-app', clientSecret: 'test-secret' })
    const service = new InstagramService()
    const state = new URL(await service.getAuthUrl()).searchParams.get('state')!
    const cap: Captured[] = []
    mockGraphApi(cap, (url) => {
      if (url.includes('fb_exchange_token'))
        return Response.json({ error: { message: 'Provider refused exchange' } }, { status: 400 })
      if (url.includes('code=valid-code')) return Response.json({ access_token: 'SHORT' })
      return null
    })

    await expect(service.handleCallback('valid-code', state)).rejects.toMatchObject({ code: 'instagram_token_exchange_failed' })
    expect(cap).toHaveLength(2)
    expect(cap.every(call => call.url.includes('/oauth/access_token'))).toBe(true)
  })
})

describe('InstagramDriver carousels', () => {
  const identity = { handle: 'me', did: '17', accessToken: 'token' }

  test('two or more images become a carousel; one stays a single image', async () => {
    const realFetch = globalThis.fetch
    const bodies: URLSearchParams[] = []
    let next = 500
    globalThis.fetch = (async (input: any, init: any = {}) => {
      if (init.method === 'POST') bodies.push(new URLSearchParams(String(init.body)))
      if (String(input).includes('fields=permalink')) return new Response(JSON.stringify({ permalink: 'https://www.instagram.com/p/x' }), { status: 200 })
      return new Response(JSON.stringify({ id: String(next++) }), { status: 200 })
    }) as typeof fetch
    try {
      const { InstagramDriver } = await import('../../app/Services/Social/Drivers/InstagramDriver')
      const result = await new InstagramDriver().publish(identity, { text: 'album', media: [{ url: 'https://media.example.com/1.jpg' }, { url: 'https://media.example.com/2.jpg' }] })
      expect(bodies.slice(0, 2).map(body => body.get('is_carousel_item'))).toEqual(['true', 'true'])
      expect(bodies[2]!.get('media_type')).toBe('CAROUSEL')
      expect(bodies[2]!.get('children')).toBe('500,501')
      expect(bodies[2]!.get('caption')).toBe('album')
      expect(bodies[3]!.get('creation_id')).toBe('502')
      expect(result.url).toBe('https://www.instagram.com/p/x')

      bodies.length = 0
      await new InstagramDriver().publish(identity, { text: 'single', media: [{ url: 'https://media.example.com/1.jpg' }] })
      expect(bodies[0]!.get('image_url')).toBe('https://media.example.com/1.jpg')
      expect(bodies[0]!.get('is_carousel_item')).toBeNull()

      await expect(new InstagramDriver().publish(identity, { text: 'no address', media: [{ bytes: new Uint8Array([1]) }] })).rejects.toThrow('public address')
    }
    finally {
      globalThis.fetch = realFetch
    }
  })
})
