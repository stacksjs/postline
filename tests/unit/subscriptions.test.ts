import { describe, expect, test } from 'bun:test'
import { isEmail, normalizeEmail } from '../../app/Services/SubscriberService'

describe('subscriber email handling', () => {
  test('addresses are lowercased and trimmed for comparison', () => {
    expect(normalizeEmail('  Reader@Example.COM ')).toBe('reader@example.com')
    expect(normalizeEmail(undefined)).toBe('')
  })

  test('plus-tags and dots are preserved, not normalised away', () => {
    // Some providers treat these as distinct addresses. Collapsing them would
    // let one reader unsubscribe another.
    expect(normalizeEmail('a.reader+postline@example.com')).toBe('a.reader+postline@example.com')
  })

  test('validation is permissive, since the confirmation mail is the real check', () => {
    expect(isEmail('reader@example.com')).toBe(true)
    expect(isEmail('a+b@sub.example.co.uk')).toBe(true)
    expect(isEmail('not-an-email')).toBe(false)
    expect(isEmail('missing@domain')).toBe(false)
    expect(isEmail('two spaces@example.com')).toBe(false)
  })
})
