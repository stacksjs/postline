import { describe, expect, test } from 'bun:test'
import { checkoutBaseUrl } from '../../app/Services/BillingService'
import { isEmail, normalizeEmail } from '../../app/Services/SubscriberService'

describe('subscriber email handling', () => {
  test('addresses are lowercased and trimmed for comparison', () => {
    expect(normalizeEmail('  Reader@Example.COM ')).toBe('reader@example.com')
    expect(normalizeEmail(undefined)).toBe('')
  })

  test('plus-tags and dots are preserved, not normalised away', () => {
    // Some providers treat these as distinct addresses. Collapsing them would
    // let one reader unsubscribe another.
    expect(normalizeEmail('a.reader+opentimes@example.com')).toBe('a.reader+opentimes@example.com')
  })

  test('validation is permissive, since the confirmation mail is the real check', () => {
    expect(isEmail('reader@example.com')).toBe(true)
    expect(isEmail('a+b@sub.example.co.uk')).toBe(true)
    expect(isEmail('not-an-email')).toBe(false)
    expect(isEmail('missing@domain')).toBe(false)
    expect(isEmail('two spaces@example.com')).toBe(false)
  })
})

describe('checkout base url', () => {
  test('a bare host gains a scheme, which is what Stripe requires', () => {
    // Stripe rejects a scheme-less return URL with `url_invalid`, and APP_URL
    // is a bare host in this app.
    expect(checkoutBaseUrl('opentimes.stacksjs.com')).toBe('https://opentimes.stacksjs.com')
  })

  test('localhost gets http, since a local box has no certificate', () => {
    expect(checkoutBaseUrl('theopentimes.localhost')).toBe('http://theopentimes.localhost')
    expect(checkoutBaseUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(checkoutBaseUrl('127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
  })

  test('an absolute url is left alone', () => {
    expect(checkoutBaseUrl('https://example.com')).toBe('https://example.com')
    expect(checkoutBaseUrl('http://example.com')).toBe('http://example.com')
  })

  test('trailing slashes are trimmed, so paths do not double up', () => {
    expect(checkoutBaseUrl('https://example.com///')).toBe('https://example.com')
  })

  test('an empty value falls back rather than producing a broken url', () => {
    expect(checkoutBaseUrl('')).toBe('http://localhost:3000')
    expect(checkoutBaseUrl(undefined)).toBe('http://localhost:3000')
  })
})
