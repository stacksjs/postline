import { describe, expect, test } from 'bun:test'
import { BlueskyApiError } from '../../app/Services/Social/Drivers/BlueskyDriver'
import { describeNetworkError } from '../../app/Support/Social/network-errors'

const apiError = (status: number, body = '') =>
  new BlueskyApiError(`Bluesky API failed (${status})`, status, body)

/** Bluesky failures go through the same explainer as every network (#134). */
describe('Bluesky errors', () => {
  test('each status reads as what happened and what to do', () => {
    expect(describeNetworkError('bluesky', apiError(429))).toMatch(/limiting how often/)
    expect(describeNetworkError('bluesky', apiError(401))).toMatch(/Connect the account again/)
    // A 403 is a refusal of this action, not a dead session.
    expect(describeNetworkError('bluesky', apiError(403))).toMatch(/did not allow this/)
    expect(describeNetworkError('bluesky', apiError(413))).toMatch(/would not take the image/)
    expect(describeNetworkError('bluesky', apiError(503))).toMatch(/having trouble/)
  })

  test('the network\'s own reason is quoted, never its raw body', () => {
    const message = describeNetworkError('bluesky', apiError(400, '{"error":"InvalidRequest","message":"Record too long"}'))
    expect(message).toContain('Record too long')
    expect(message).not.toContain('{')
  })

  test('an unreachable network and Postline\'s own sentences', () => {
    expect(describeNetworkError('bluesky', new TypeError('fetch failed'))).toBe('Postline could not reach Bluesky. It will try again shortly.')
    expect(describeNetworkError('bluesky', new Error('Write something before publishing.'))).toBe('Write something before publishing.')
  })
})
