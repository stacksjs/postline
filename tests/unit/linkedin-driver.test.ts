import { afterEach, describe, expect, test } from 'bun:test'
import { LinkedInApiError, LinkedInDriver } from '../../app/Services/Social/Drivers/LinkedInDriver'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const identity = { handle: 'glenn', did: 'urn:li:person:ABC', accessToken: 'tok' }

interface Captured { url: string, method: string, body: any, headers: any }

/**
 * Mock LinkedIn's versioned REST API. Recognizes the three calls an image post
 * makes — initializeUpload, the binary PUT, and the /rest/posts create — plus a
 * bytes fallback for any other GET (used when the driver fetches a media URL).
 */
function mockLinkedInApi(captured: Captured[], overrides: (url: string, method: string) => Response | null = () => null): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    const method = init.method || 'GET'

    const over = overrides(url, method)
    if (over) { captured.push({ url, method, body: init.body, headers: init.headers }); return over }

    if (url.includes('action=initializeUpload')) {
      captured.push({ url, method, body: init.body, headers: init.headers })
      return new Response(
        JSON.stringify({ value: { uploadUrl: 'https://upload.linkedin.example/img', image: 'urn:li:image:IMG123' } }),
        { status: 200 },
      )
    }
    if (method === 'PUT') {
      captured.push({ url, method, body: init.body, headers: init.headers })
      return new Response(null, { status: 201 })
    }
    if (url.endsWith('/rest/posts')) {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      captured.push({ url, method, body, headers: init.headers })
      return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:987' } })
    }
    // Fallback: fetching a remote media URL — hand back a few bytes.
    captured.push({ url, method, body: undefined, headers: init.headers })
    return new Response(new Uint8Array([9, 9, 9]) as any, { status: 200, headers: { 'content-type': 'image/png' } })
  }) as typeof fetch
}

function postRequest(captured: Captured[]): Captured | undefined {
  return captured.find(c => c.url.endsWith('/rest/posts'))
}

describe('LinkedInDriver.publish', () => {
  test('publishes a plain text share with no content block', async () => {
    const cap: Captured[] = []; mockLinkedInApi(cap)
    const driver = new LinkedInDriver()
    const result = await driver.publish(identity, { text: 'hello linkedin' })

    const post = postRequest(cap)
    expect(post?.body.commentary).toBe('hello linkedin')
    expect(post?.body.content).toBeUndefined()
    expect(cap.find(c => c.url.includes('initializeUpload'))).toBeUndefined()
    expect(result.uri).toBe('urn:li:share:987')
    expect(result.url).toContain('linkedin.com/feed/update/urn:li:share:987')
  })

  test('attaches an article link card when external is provided and no image', async () => {
    const cap: Captured[] = []; mockLinkedInApi(cap)
    const driver = new LinkedInDriver()
    await driver.publish(identity, {
      text: 'read this',
      external: { uri: 'https://example.com', title: 'Example', description: 'Desc' },
    })

    const post = postRequest(cap)
    expect(post?.body.content.article.source).toBe('https://example.com')
    expect(post?.body.content.media).toBeUndefined()
    expect(cap.find(c => c.url.includes('initializeUpload'))).toBeUndefined()
  })

  test('uploads image bytes and references the URN under content.media', async () => {
    const cap: Captured[] = []; mockLinkedInApi(cap)
    const driver = new LinkedInDriver()
    await driver.publish(identity, {
      text: 'photo',
      media: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', altText: 'a chart' }],
    })

    const init = cap.find(c => c.url.includes('initializeUpload'))
    expect(init).toBeDefined()
    expect(JSON.parse(String(init!.body)).initializeUploadRequest.owner).toBe('urn:li:person:ABC')

    const put = cap.find(c => c.method === 'PUT')
    expect(put?.url).toBe('https://upload.linkedin.example/img')

    const post = postRequest(cap)
    expect(post?.body.content.media.id).toBe('urn:li:image:IMG123')
    expect(post?.body.content.media.altText).toBe('a chart')
    expect(post?.body.content.article).toBeUndefined()
  })

  test('fetches a media URL to bytes when only a url is given', async () => {
    const cap: Captured[] = []; mockLinkedInApi(cap)
    const driver = new LinkedInDriver()
    await driver.publish(identity, { text: 'via url', media: [{ url: 'https://cdn.example/pic.png' }] })

    expect(cap.find(c => c.url === 'https://cdn.example/pic.png')).toBeDefined()
    expect(cap.find(c => c.url.includes('initializeUpload'))).toBeDefined()
    expect(postRequest(cap)?.body.content.media.id).toBe('urn:li:image:IMG123')
  })

  test('an attached image supersedes an article link card', async () => {
    const cap: Captured[] = []; mockLinkedInApi(cap)
    const driver = new LinkedInDriver()
    await driver.publish(identity, {
      text: 'both',
      external: { uri: 'https://example.com', title: 'E' },
      media: [{ bytes: new Uint8Array([1]), mimeType: 'image/jpeg' }],
    })

    const post = postRequest(cap)
    expect(post?.body.content.media.id).toBe('urn:li:image:IMG123')
    expect(post?.body.content.article).toBeUndefined()
  })

  test('rejects text over the character limit before calling the API', async () => {
    const cap: Captured[] = []; mockLinkedInApi(cap)
    const driver = new LinkedInDriver()
    await expect(driver.publish(identity, { text: 'x'.repeat(3001) })).rejects.toThrow(/3000 characters/)
    expect(cap).toHaveLength(0)
  })

  test('rejects when the identity has no member URN', async () => {
    const cap: Captured[] = []; mockLinkedInApi(cap)
    const driver = new LinkedInDriver()
    await expect(driver.publish({ handle: 'glenn', accessToken: 'tok' }, { text: 'hi' })).rejects.toThrow(/member URN/)
    expect(cap).toHaveLength(0)
  })

  test('rejects when the identity has no access token', async () => {
    const cap: Captured[] = []; mockLinkedInApi(cap)
    const driver = new LinkedInDriver()
    await expect(driver.publish({ handle: 'glenn', did: 'urn:li:person:ABC' }, { text: 'hi' })).rejects.toThrow(/access token/)
    expect(cap).toHaveLength(0)
  })

  test('surfaces a posts API error as LinkedInApiError with status', async () => {
    const cap: Captured[] = []
    mockLinkedInApi(cap, url => url.endsWith('/rest/posts') ? new Response('{"message":"nope"}', { status: 401 }) : null)
    const driver = new LinkedInDriver()
    let caught: unknown
    await driver.publish(identity, { text: 'hi' }).catch((e) => { caught = e })
    expect(caught).toBeInstanceOf(LinkedInApiError)
    expect((caught as LinkedInApiError).status).toBe(401)
    expect((caught as LinkedInApiError).isAuthError).toBe(true)
  })

  test('surfaces an image upload failure as LinkedInApiError', async () => {
    const cap: Captured[] = []
    mockLinkedInApi(cap, (_url, method) => method === 'PUT' ? new Response('fail', { status: 500 }) : null)
    const driver = new LinkedInDriver()
    let caught: unknown
    await driver.publish(identity, { text: 'photo', media: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }] })
      .catch((e) => { caught = e })
    expect(caught).toBeInstanceOf(LinkedInApiError)
    expect((caught as LinkedInApiError).status).toBe(500)
    // The post itself must never be created when its image failed to upload.
    expect(postRequest(cap)).toBeUndefined()
  })
})

interface TokenCall { url: string, body: string }

function mockTokenEndpoint(captured: TokenCall[], payload: Record<string, unknown>, status = 200): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    captured.push({ url: String(input), body: String(init.body || '') })
    return new Response(JSON.stringify(payload), { status })
  }) as typeof fetch
}

describe('LinkedInDriver token exchange + refresh', () => {
  test('exchangeCode surfaces the refresh token the base driver drops', async () => {
    const cap: TokenCall[] = []
    mockTokenEndpoint(cap, { access_token: 'AT1', expires_in: 5184000, refresh_token: 'RT1', refresh_token_expires_in: 31536000 })
    const driver = new LinkedInDriver()

    const token = await driver.exchangeCode({ clientId: 'c', clientSecret: 's', redirectUrl: 'https://app/cb', code: 'abc' })

    expect(cap[0].url).toContain('/oauth/v2/accessToken')
    expect(cap[0].body).toContain('grant_type=authorization_code')
    expect(token.accessToken).toBe('AT1')
    expect(token.refreshToken).toBe('RT1')
    expect(token.expiresIn).toBe(5184000)
  })

  test('refreshAccessToken mints a new token from a refresh token', async () => {
    const cap: TokenCall[] = []
    mockTokenEndpoint(cap, { access_token: 'AT2', expires_in: 5184000, refresh_token: 'RT2' })
    const driver = new LinkedInDriver()

    const token = await driver.refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'RT1' })

    expect(cap[0].body).toContain('grant_type=refresh_token')
    expect(cap[0].body).toContain('refresh_token=RT1')
    expect(token.accessToken).toBe('AT2')
    expect(token.refreshToken).toBe('RT2')
  })

  test('refreshAccessToken throws when LinkedIn returns no token', async () => {
    const cap: TokenCall[] = []
    mockTokenEndpoint(cap, { error: 'invalid_grant' }, 400)
    const driver = new LinkedInDriver()
    let caught: unknown
    await driver.refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'stale' }).catch((e) => { caught = e })
    expect(caught).toBeInstanceOf(LinkedInApiError)
    expect((caught as LinkedInApiError).status).toBe(400)
  })
})
