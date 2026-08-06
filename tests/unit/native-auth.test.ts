import { describe, expect, it } from 'bun:test'
import { allowsNativeAppWithoutLogin } from '../../app/Support/Auth/native'

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('native app authentication', () => {
  it('allows a Craft request on a loopback host during development', () => {
    expect(allowsNativeAppWithoutLogin(headers({
      host: 'localhost:3008',
      'x-ot-native': 'craft',
    }), 'development')).toBe(true)
  })

  it('allows a Craft request with a loopback origin during development', () => {
    expect(allowsNativeAppWithoutLogin(headers({
      origin: 'http://localhost:3002',
      'x-ot-native': 'craft',
    }), 'local')).toBe(true)
  })

  it('keeps normal browser requests behind authentication', () => {
    expect(allowsNativeAppWithoutLogin(headers({
      host: 'localhost:3008',
    }), 'development')).toBe(false)
  })

  it('rejects a native marker from a remote host', () => {
    expect(allowsNativeAppWithoutLogin(headers({
      host: 'opentimes.example.com',
      'x-ot-native': 'craft',
    }), 'development')).toBe(false)
  })

  it('never bypasses authentication in production', () => {
    expect(allowsNativeAppWithoutLogin(headers({
      host: 'localhost:3008',
      'x-ot-native': 'craft',
    }), 'production')).toBe(false)
  })
})
