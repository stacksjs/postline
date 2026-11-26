import { describe, expect, test } from 'bun:test'
import { describeNetworkError, explainNetworkError, networkReason } from '../../app/Support/Social/network-errors'

const apiError = (status: number, body: unknown = ''): Error =>
  Object.assign(new Error(`API failed (${status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`), { status, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('what kind of failure it was', () => {
  test('X refusing a duplicate is a duplicate, not a signed-out account', () => {
    const explained = explainNetworkError('twitter', apiError(403, { detail: 'You are not allowed to create a Tweet with duplicate content.', type: 'about:blank', title: 'Forbidden', status: 403 }))
    expect(explained.kind).toBe('duplicate')
    expect(explained.message).toContain('duplicate')
  })

  test('only a rejected sign-in is expired', () => {
    expect(explainNetworkError('twitter', apiError(401, { title: 'Unauthorized' })).kind).toBe('expired')
    expect(explainNetworkError('linkedin', apiError(401, { message: 'The token used in the request has been revoked by the user', serviceErrorCode: 65601 })).kind).toBe('expired')
    expect(explainNetworkError('threads', apiError(400, { error: { message: 'Error validating access token: Session has expired on Friday', type: 'OAuthException', code: 190 } })).kind).toBe('expired')
    expect(explainNetworkError('mastodon', apiError(403, { error: 'This action is outside the authorized scopes' })).kind).toBe('permission')
    expect(explainNetworkError('linkedin', apiError(403, { message: 'Not enough permissions to access: ugcPosts.CREATE' })).kind).toBe('permission')
  })

  test('rate limits, media, content and outages', () => {
    expect(explainNetworkError('twitter', apiError(429, { title: 'Too Many Requests' })).kind).toBe('rate-limited')
    expect(explainNetworkError('mastodon', apiError(422, { error: 'Validation failed: Text character limit of 500 exceeded' })).kind).toBe('content')
    expect(explainNetworkError('instagram', apiError(400, { error: { message: 'The aspect ratio is not supported', code: 36003 } })).kind).toBe('media')
    expect(explainNetworkError('bluesky', apiError(413)).kind).toBe('media')
    expect(explainNetworkError('linkedin', apiError(503, '<html>Service Unavailable</html>')).kind).toBe('temporary')
    expect(explainNetworkError('mastodon', new TypeError('fetch failed')).kind).toBe('temporary')
    expect(explainNetworkError('linkedin', apiError(422, { message: 'Content is a duplicate of urn:li:share:123', code: 'DUPLICATE_POST' })).kind).toBe('duplicate')
  })
})

describe('what the owner reads', () => {
  test('never the raw response', () => {
    const bodies = [
      apiError(403, { detail: 'You are not allowed to create a Tweet with duplicate content.', type: 'about:blank', title: 'Forbidden', status: 403 }),
      apiError(422, { message: 'Content is a duplicate of urn:li:share:123', code: 'DUPLICATE_POST', status: 422 }),
      apiError(500, '<html><body><h1>500</h1></body></html>'),
      apiError(400, { error: { message: 'Unsupported post request.', type: 'GraphMethodException', code: 100, fbtrace_id: 'AbCdEf' } }),
    ]
    for (const error of bodies) {
      const message = describeNetworkError('twitter', error)
      expect(message).not.toMatch(/[{}<>]/)
      expect(message).not.toContain('about:blank')
      expect(message).not.toContain('fbtrace')
      expect(message).not.toContain('API failed')
    }
  })

  test('the network\'s own reason is quoted when it is a sentence', () => {
    const message = describeNetworkError('mastodon', apiError(422, { error: 'Validation failed: Text character limit of 500 exceeded' }))
    expect(message).toBe('Mastodon rejected the post. Mastodon said: Validation failed: Text character limit of 500 exceeded. Edit it and try again.')
  })

  test('a code or a dump is not quoted as a reason', () => {
    expect(networkReason(JSON.stringify({ error: 'invalid_request' }))).toBe('')
    expect(networkReason('<html>nope</html>')).toBe('')
    expect(networkReason(JSON.stringify({ message: 'x'.repeat(300) }))).toBe('')
    expect(networkReason(JSON.stringify({ errors: [{ message: 'Status is a duplicate.' }] }))).toBe('Status is a duplicate')
  })

  test('says what to do', () => {
    expect(describeNetworkError('twitter', apiError(401))).toBe('X no longer accepts this sign-in. Connect the account again under Settings, Channels.')
    expect(describeNetworkError('threads', apiError(429))).toContain('try again later')
    expect(describeNetworkError('linkedin', new TypeError('fetch failed'))).toBe('Postline could not reach LinkedIn. It will try again shortly.')
  })

  test('a message Postline wrote itself passes through unchanged', () => {
    expect(describeNetworkError('twitter', new Error('Connect X/Twitter before publishing.'))).toBe('Connect X/Twitter before publishing.')
    expect(describeNetworkError('mastodon', new Error('Posts on hachyderm.io must be 500 characters or fewer.'))).toBe('Posts on hachyderm.io must be 500 characters or fewer.')
  })
})

describe('the same failure, named for what Postline was doing (#134)', () => {
  test('a rate limit while deleting says deleting, and while searching says searching', async () => {
    const { describeNetworkError } = await import('../../app/Support/Social/network-errors')
    const limited = Object.assign(new Error('Too Many Requests'), { status: 429 })
    expect(describeNetworkError('twitter', limited, 'delete')).toContain('delete posts')
    expect(describeNetworkError('mastodon', limited, 'search')).toContain('search')
    expect(describeNetworkError('bluesky', limited, 'read')).toContain('read messages')
  })

  test('a raw API body is never passed on', async () => {
    const { describeNetworkError } = await import('../../app/Support/Social/network-errors')
    const raw = new Error('{"errors":[{"code":"InternalError","message":"stack trace follows"}]}')
    const message = describeNetworkError('bluesky', raw, 'read')
    expect(message).not.toContain('{')
    expect(message).toBe('Bluesky could not load your messages.')
    // Postline's own sentences pass through as they are.
    expect(describeNetworkError('threads', new Error('Threads cannot list your whole post history to Postline.'), 'delete')).toBe('Threads cannot list your whole post history to Postline.')
  })
})
