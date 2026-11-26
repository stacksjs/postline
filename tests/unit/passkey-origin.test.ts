/**
 * The origin passkeys are bound to (#95). A passkey works only on the exact
 * origin it was made on, so this has to name what the browser shows.
 */
import { describe, expect, test } from 'bun:test'
import { passkeyOrigin } from '../../config/auth'
import { url as canonical } from '../../config/domains'

describe('passkey origin', () => {
  test('APP_URL without a scheme is https', () => {
    expect(passkeyOrigin({ APP_URL: 'postline.localhost' })).toBe('https://postline.localhost')
  })

  test('localhost is http, as browsers allow passkeys there without TLS', () => {
    expect(passkeyOrigin({ APP_URL: 'localhost:3000' })).toBe('http://localhost:3000')
    expect(passkeyOrigin({ APP_URL: '127.0.0.1:3000/' })).toBe('http://127.0.0.1:3000')
  })

  test('PASSKEY_ORIGIN wins, reduced to an origin', () => {
    expect(passkeyOrigin({ APP_URL: 'postline.localhost', PASSKEY_ORIGIN: 'https://social.example.com/composer' })).toBe('https://social.example.com')
  })

  test('nothing usable falls back to the canonical host', () => {
    expect(passkeyOrigin({})).toBe(canonical)
    expect(passkeyOrigin({ APP_URL: 'http://' })).toBe(canonical)
  })
})
