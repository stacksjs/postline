import { describe, expect, test } from 'bun:test'
import { canonicalAcct } from '../../app/Services/Social/DirectMessages/mastodon'
import { DM_PROVIDERS, DM_UNAVAILABLE, isDmProvider } from '../../app/Support/Social/direct-messages'
import { stripHtml } from '../../app/Support/Social/text'

describe('dm provider registry', () => {
  test('only the networks Postline can read messages on are listed', () => {
    expect([...DM_PROVIDERS]).toEqual(['bluesky', 'mastodon'])
    expect(isDmProvider('bluesky')).toBe(true)
    // Instagram needs Meta's app review and X its paid message API (#129).
    expect(isDmProvider('instagram')).toBe(false)
    expect(isDmProvider('twitter')).toBe(false)
    expect(DM_UNAVAILABLE.instagram).toContain('app review')
    expect(DM_UNAVAILABLE.twitter).toContain('not supported yet')
    expect(isDmProvider('threads')).toBe(false)
    expect(isDmProvider(undefined)).toBe(false)
  })

  test('every unsupported network explains itself', () => {
    for (const [provider, reason] of Object.entries(DM_UNAVAILABLE)) {
      expect(DM_PROVIDERS).not.toContain(provider as never)
      expect(reason.length).toBeGreaterThan(20)
    }
  })
})

describe('mastodon account matching', () => {
  test('a local account is qualified with our own instance host', () => {
    expect(canonicalAcct('chris', 'https://mastodon.social')).toBe('chris@mastodon.social')
    expect(canonicalAcct('@chris', 'https://mastodon.social')).toBe('chris@mastodon.social')
  })

  test('a remote account keeps its own host', () => {
    expect(canonicalAcct('@someone@fosstodon.org', 'https://mastodon.social')).toBe('someone@fosstodon.org')
  })

  test('our stored handle and a local status author resolve to the same value', () => {
    const instance = 'https://mastodon.social'
    expect(canonicalAcct('@chris@mastodon.social', instance)).toBe(canonicalAcct('chris', instance))
  })

  test('a blank account never matches anything', () => {
    expect(canonicalAcct('', 'https://mastodon.social')).toBe('')
  })
})

describe('mastodon body text', () => {
  test('status HTML is flattened to readable plain text', () => {
    expect(stripHtml('<p>Hey <a href="#">@you</a></p><p>Second line</p>')).toBe('Hey @you\n\nSecond line')
    expect(stripHtml('one<br>two')).toBe('one\ntwo')
    expect(stripHtml('&lt;script&gt; &amp; &quot;quotes&quot;')).toBe('<script> & "quotes"')
  })
})
