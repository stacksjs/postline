import { afterEach, describe, expect, it } from 'bun:test'
import { allowsNativeAppWithoutLogin, isDesktopAgent } from '../../app/Support/Auth/native'

const original = process.env.POSTLINE_DESKTOP_AGENT

afterEach(() => {
  if (original === undefined)
    delete process.env.POSTLINE_DESKTOP_AGENT
  else
    process.env.POSTLINE_DESKTOP_AGENT = original
})

describe('skipping the sign-in', () => {
  it('is allowed only for the desktop agent process', () => {
    process.env.POSTLINE_DESKTOP_AGENT = '1'
    expect(isDesktopAgent()).toBe(true)
    expect(allowsNativeAppWithoutLogin()).toBe(true)
  })

  it('is refused for every other process', () => {
    delete process.env.POSTLINE_DESKTOP_AGENT
    expect(isDesktopAgent()).toBe(false)
    expect(allowsNativeAppWithoutLogin()).toBe(false)
  })

  it('accepts only the exact flag value', () => {
    for (const value of ['', '0', 'true', 'yes']) {
      process.env.POSTLINE_DESKTOP_AGENT = value
      expect(allowsNativeAppWithoutLogin()).toBe(false)
    }
  })

  it('takes no input from the request', () => {
    // The function has no parameters on purpose: anything read from a request
    // is chosen by the caller.
    expect(allowsNativeAppWithoutLogin.length).toBe(0)
  })
})
