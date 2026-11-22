import { describe, expect, test } from 'bun:test'
import { LINKEDIN_API_VERSION, linkedInCommentary, linkedInVersionSunset, resolveLinkedInVersion } from '../../app/Support/Social/linkedin-text'

describe('the LinkedIn API version', () => {
  test('is not within two months of being retired', () => {
    // LinkedIn retires a version a year after it ships, and a retired header
    // fails every call. When this fails, move LINKEDIN_API_VERSION to the
    // latest month listed at
    // https://learn.microsoft.com/en-us/linkedin/marketing/versioning
    const sunset = linkedInVersionSunset(LINKEDIN_API_VERSION).getTime()
    const twoMonths = 61 * 24 * 60 * 60 * 1000
    expect(Date.now()).toBeLessThan(sunset - twoMonths)
  })

  test('a retired or malformed override is ignored', () => {
    const now = Date.UTC(2026, 10, 22)
    expect(resolveLinkedInVersion('202405', now)).toBe(LINKEDIN_API_VERSION)
    expect(resolveLinkedInVersion('latest', now)).toBe(LINKEDIN_API_VERSION)
    expect(resolveLinkedInVersion('', now)).toBe(LINKEDIN_API_VERSION)
    expect(resolveLinkedInVersion('202609', now)).toBe('202609')
  })

  test('a version is retired a year on', () => {
    expect(linkedInVersionSunset('202611').toISOString().slice(0, 10)).toBe('2027-11-15')
    expect(linkedInVersionSunset('202601').toISOString().slice(0, 10)).toBe('2027-01-15')
  })
})

describe('LinkedIn post text', () => {
  test('a hashtag stays a hashtag', () => {
    expect(linkedInCommentary('Shipping today #opensource #Bun')).toBe('Shipping today #opensource #Bun')
    expect(linkedInCommentary('#launch day')).toBe('#launch day')
    expect(linkedInCommentary('Neu: #Veröffentlichung')).toBe('Neu: #Veröffentlichung')
  })

  test('a # that is not a hashtag is escaped', () => {
    expect(linkedInCommentary('issue #4')).toBe('issue \\#4')
    expect(linkedInCommentary('C# and F#')).toBe('C\\# and F\\#')
    expect(linkedInCommentary('a # b')).toBe('a \\# b')
  })

  test('the other reserved characters are escaped', () => {
    expect(linkedInCommentary('a (b) [c] {d} <e> x*y _z_ ~n~ me@x.io a|b \\')).toBe('a \\(b\\) \\[c\\] \\{d\\} \\<e\\> x\\*y \\_z\\_ \\~n\\~ me\\@x.io a\\|b \\\\')
  })
})
