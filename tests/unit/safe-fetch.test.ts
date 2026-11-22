import { describe, expect, test } from 'bun:test'
import { assertPublicHttpUrl, isPrivateAddress, safeFetch, UnsafeUrlError } from '../../app/Support/Http/safe-fetch'

const publicResolver = async (): Promise<string[]> => ['93.184.216.34']

describe('isPrivateAddress', () => {
  test.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('%s is refused', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  test.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('%s is public', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})

describe('assertPublicHttpUrl', () => {
  test.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'javascript:alert(1)',
    'http://localhost/x',
    'http://app.localhost/x',
    'http://printer.local/',
    'http://127.0.0.1:3008/api',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://user:pass@example.com/',
    'not a url',
    '',
  ])('refuses %s', async (value) => {
    await expect(assertPublicHttpUrl(value, publicResolver)).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  test('refuses a public name that resolves to a private address', async () => {
    await expect(assertPublicHttpUrl('https://internal.example.com/', async () => ['10.0.0.5'])).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  test('refuses a name when any of its addresses is private', async () => {
    await expect(assertPublicHttpUrl('https://mixed.example.com/', async () => ['93.184.216.34', '127.0.0.1'])).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  test('accepts a public address', async () => {
    const url = await assertPublicHttpUrl('https://example.com/page?x=1', publicResolver)

    expect(url.hostname).toBe('example.com')
  })
})

describe('safeFetch', () => {
  const options = { timeoutMs: 1000, maxBytes: 16, resolve: publicResolver }

  test('returns the body and content type', async () => {
    const fetcher = (async () => new Response('hello', { headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch
    const result = await safeFetch('https://example.com/', { ...options, fetcher })

    expect(new TextDecoder().decode(result.bytes)).toBe('hello')
    expect(result.contentType).toBe('text/html')
    expect(result.truncated).toBe(false)
  })

  test('stops reading at the size cap', async () => {
    const fetcher = (async () => new Response('x'.repeat(1000))) as unknown as typeof fetch
    const result = await safeFetch('https://example.com/', { ...options, fetcher })

    expect(result.bytes.byteLength).toBe(16)
    expect(result.truncated).toBe(true)
  })

  test('refuses a redirect to a private address', async () => {
    const fetcher = (async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:3008/api/postline/queue' } })) as unknown as typeof fetch

    await expect(safeFetch('https://example.com/', { ...options, fetcher })).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  test('gives up after too many redirects', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls++
      return new Response(null, { status: 302, headers: { location: `https://example.com/${calls}` } })
    }) as unknown as typeof fetch

    await expect(safeFetch('https://example.com/', { ...options, fetcher })).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(calls).toBe(4)
  })

  test('follows a redirect to another public address', async () => {
    let calls = 0
    const fetcher = (async () => {
      calls++
      return calls === 1
        ? new Response(null, { status: 301, headers: { location: '/moved' } })
        : new Response('ok')
    }) as unknown as typeof fetch
    const result = await safeFetch('https://example.com/', { ...options, fetcher })

    expect(result.url.pathname).toBe('/moved')
  })

  test('enforces the deadline over the whole exchange', async () => {
    const fetcher = ((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as unknown as typeof fetch

    await expect(safeFetch('https://example.com/', { ...options, timeoutMs: 20, fetcher })).rejects.toBeInstanceOf(UnsafeUrlError)
  })
})
