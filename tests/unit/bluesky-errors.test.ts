import { describe, expect, test } from 'bun:test'
import { BlueskyApiError } from '../../app/Services/Social/Drivers/BlueskyDriver'
import { describeBlueskyError } from '../../app/Support/Social/bluesky-errors'

const apiError = (status: number, body = '') =>
  new BlueskyApiError(`Bluesky API failed (${status})`, status, body)

describe('describeBlueskyError', () => {
  test('maps rate limit (429) to an actionable message', () => {
    expect(describeBlueskyError(apiError(429))).toMatch(/rate limit/i)
  })

  test('maps auth errors (401/403) to a reconnect prompt', () => {
    expect(describeBlueskyError(apiError(401))).toMatch(/reconnect/i)
    expect(describeBlueskyError(apiError(403))).toMatch(/reconnect/i)
  })

  test('maps oversized image (413)', () => {
    expect(describeBlueskyError(apiError(413))).toMatch(/1MB/i)
  })

  test('maps 5xx to a transient-trouble message', () => {
    expect(describeBlueskyError(apiError(503))).toMatch(/trouble/i)
  })

  test('surfaces the ATProto body message for other statuses', () => {
    const err = apiError(400, JSON.stringify({ error: 'InvalidRequest', message: 'Record too long' }))
    expect(describeBlueskyError(err)).toBe('Bluesky rejected the post: Record too long')
  })

  test('maps network failures to a connectivity message', () => {
    expect(describeBlueskyError(new TypeError('fetch failed'))).toMatch(/couldn't reach bluesky/i)
  })

  test('passes through a plain error message unchanged', () => {
    expect(describeBlueskyError(new Error('Write something before publishing.'))).toBe('Write something before publishing.')
  })
})
