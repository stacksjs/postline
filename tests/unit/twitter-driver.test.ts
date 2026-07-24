import { afterEach, describe, expect, test } from 'bun:test'
import { TwitterApiError, TwitterDriver } from '../../app/Services/Social/Drivers/TwitterDriver'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const identity = { handle: 'glenn', did: '77', accessToken: 'AT' }

interface Captured { url: string, method: string, body: any, headers: any }

function mockTwitterApi(captured: Captured[], overrides: (url: string) => Response | null = () => null): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    const method = init.method || 'GET'
    const over = overrides(url)
    if (over) { captured.push({ url, method, body: init.body, headers: init.headers }); return over }

    if (url.includes('/2/oauth2/token')) {
      captured.push({ url, method, body: init.body, headers: init.headers })
      return new Response(JSON.stringify({ token_type: 'bearer', expires_in: 7200, access_token: 'NEW_AT', refresh_token: 'NEW_RT', scope: 'tweet.write' }), { status: 200 })
    }
    if (url.includes('/2/users/me')) {
      captured.push({ url, method, body: init.body, headers: init.headers })
      return new Response(JSON.stringify({ data: { id: '77', username: 'glenn', name: 'Glenn' } }), { status: 200 })
    }
    if (url.includes('/2/media/upload')) {
      captured.push({ url, method, body: init.body, headers: init.headers })
      return new Response(JSON.stringify({ data: { id: 'media123' } }), { status: 200 })
    }
    // /2/tweets
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    captured.push({ url, method, body, headers: init.headers })
    return new Response(JSON.stringify({ data: { id: 'tweet999' } }), { status: 200 })
  }) as typeof fetch
}

function tweetRequest(captured: Captured[]): Captured | undefined {
  return captured.find(c => c.url.endsWith('/2/tweets'))
}

describe('TwitterDriver.createAuthorization (PKCE)', () => {
  test('builds a consent URL with an S256 challenge and returns the verifier', async () => {
    const driver = new TwitterDriver()
    const { url, codeVerifier } = await driver.createAuthorization({
      clientId: 'cid',
      redirectUrl: 'https://app.example/cb',
      scopes: ['tweet.read', 'tweet.write', 'offline.access'],
      state: 'st8',
    })

    expect(url).toContain('twitter.com/i/oauth2/authorize')
    expect(url).toContain('client_id=cid')
    expect(url).toContain('state=st8')
    expect(url).toContain('code_challenge=')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('scope=tweet.read+tweet.write+offline.access')
    expect(codeVerifier.length).toBeGreaterThan(20)
  })
})

describe('TwitterDriver tokens', () => {
  test('exchangeCode posts the code + PKCE verifier and returns tokens', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    const token = await driver.exchangeCode({ clientId: 'cid', redirectUrl: 'https://app/cb', code: 'abc', codeVerifier: 'ver123' })

    const call = cap.find(c => c.url.includes('/2/oauth2/token'))
    expect(String(call?.body)).toContain('grant_type=authorization_code')
    expect(String(call?.body)).toContain('code_verifier=ver123')
    expect(token.accessToken).toBe('NEW_AT')
    expect(token.refreshToken).toBe('NEW_RT')
    expect(token.expiresIn).toBe(7200)
  })

  test('exchangeCode adds HTTP Basic auth for a confidential client', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    await driver.exchangeCode({ clientId: 'cid', clientSecret: 'secret', redirectUrl: 'https://app/cb', code: 'abc', codeVerifier: 'v' })

    const call = cap.find(c => c.url.includes('/2/oauth2/token'))
    expect(call?.headers.authorization).toBe(`Basic ${btoa('cid:secret')}`)
  })

  test('refreshAccessToken uses the refresh_token grant', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    const token = await driver.refreshAccessToken({ clientId: 'cid', refreshToken: 'RT1' })

    const call = cap.find(c => c.url.includes('/2/oauth2/token'))
    expect(String(call?.body)).toContain('grant_type=refresh_token')
    expect(String(call?.body)).toContain('refresh_token=RT1')
    expect(token.accessToken).toBe('NEW_AT')
  })

  test('getProfile resolves the authenticated account', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    const profile = await driver.getProfile('AT')
    expect(cap[0].url).toContain('/2/users/me')
    expect(profile).toEqual({ id: '77', username: 'glenn', name: 'Glenn' })
  })
})

describe('TwitterDriver.publish', () => {
  test('posts a plain tweet and returns the id as both uri and cid', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    const result = await driver.publish(identity, { text: 'hello world' })

    expect(tweetRequest(cap)?.body.text).toBe('hello world')
    expect(result.uri).toBe('tweet999')
    expect(result.cid).toBe('tweet999')
    expect(result.url).toContain('x.com/glenn/status/tweet999')
    expect(cap.find(c => c.url.includes('/2/media/upload'))).toBeUndefined()
  })

  test('chains a reply via in_reply_to_tweet_id', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    await driver.publish(identity, {
      text: 'second',
      reply: { root: { uri: 't1', cid: 't1' }, parent: { uri: 't1', cid: 't1' } },
    })
    expect(tweetRequest(cap)?.body.reply.in_reply_to_tweet_id).toBe('t1')
  })

  test('uploads image bytes and attaches media_ids', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    await driver.publish(identity, { text: 'photo', media: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }] })

    expect(cap.find(c => c.url.includes('/2/media/upload'))).toBeDefined()
    expect(tweetRequest(cap)?.body.media.media_ids).toEqual(['media123'])
  })

  test('rejects text over the character limit before calling the API', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    await expect(driver.publish(identity, { text: 'x'.repeat(281) })).rejects.toThrow(/280 characters/)
    expect(cap).toHaveLength(0)
  })

  test('rejects when the identity has no access token', async () => {
    const cap: Captured[] = []; mockTwitterApi(cap)
    const driver = new TwitterDriver()
    await expect(driver.publish({ handle: 'glenn' }, { text: 'hi' })).rejects.toThrow(/access token/)
    expect(cap).toHaveLength(0)
  })

  test('surfaces an API error as TwitterApiError with status', async () => {
    const cap: Captured[] = []
    mockTwitterApi(cap, url => url.endsWith('/2/tweets') ? new Response('{"title":"Unauthorized"}', { status: 401 }) : null)
    const driver = new TwitterDriver()
    let caught: unknown
    await driver.publish(identity, { text: 'hi' }).catch((e) => { caught = e })
    expect(caught).toBeInstanceOf(TwitterApiError)
    expect((caught as TwitterApiError).status).toBe(401)
    expect((caught as TwitterApiError).isAuthError).toBe(true)
  })
})
