import { describe, expect, test } from 'bun:test'
import { crosspostProviders } from '../../app/Services/Social/CrosspostService'
import { slugify } from '../../app/Services/PublicationService'
import { DISCOVER_FORMS, ageInHours, excerptOf, isDiscoverForm, rankEntry } from '../../app/Support/Social/discover'
import { sanitizeVariants } from '../../app/Support/Social/variants'

function inputs(overrides: Partial<Parameters<typeof rankEntry>[0]> = {}) {
  return {
    subscriberCount: 0,
    readCount: 0,
    conversionCount: 0,
    recommendationCount: 0,
    ageHours: 0,
    ...overrides,
  }
}

describe('discover forms', () => {
  test('there are exactly two feeds', () => {
    expect([...DISCOVER_FORMS]).toEqual(['short', 'long'])
    expect(isDiscoverForm('short')).toBe(true)
    expect(isDiscoverForm('long')).toBe(true)
    expect(isDiscoverForm('medium')).toBe(false)
    expect(isDiscoverForm(undefined)).toBe(false)
  })
})

describe('discover ranking', () => {
  test('a conversion outweighs the reads it took to get it', () => {
    const converted = rankEntry(inputs({ conversionCount: 1 }))
    const read = rankEntry(inputs({ readCount: 10 }))
    expect(converted).toBeGreaterThan(read)
  })

  test('recommendations count, and cannot be bought by subscriber size alone', () => {
    const recommended = rankEntry(inputs({ recommendationCount: 3 }))
    // A publication 400x larger with no recommendations still loses.
    const large = rankEntry(inputs({ subscriberCount: 40_000 }))
    expect(recommended).toBeGreaterThan(large)
  })

  test('subscriber count helps sublinearly, so a big publication cannot run away with it', () => {
    const small = rankEntry(inputs({ subscriberCount: 100 }))
    const huge = rankEntry(inputs({ subscriberCount: 100_000 }))
    expect(huge).toBeGreaterThan(small)
    // 1000x the subscribers is worth well under 3x the score.
    expect(huge).toBeLessThan(small * 3)
  })

  test('score decays with age and reaches half at the half-life', () => {
    const fresh = rankEntry(inputs({ conversionCount: 10 }))
    const threeDays = rankEntry(inputs({ conversionCount: 10, ageHours: 72 }))
    const sixDays = rankEntry(inputs({ conversionCount: 10, ageHours: 144 }))

    expect(threeDays).toBeLessThan(fresh)
    expect(threeDays).toBeCloseTo(fresh / 2, 0)
    expect(sixDays).toBeCloseTo(fresh / 4, 0)
  })

  test('an entry with nothing on it scores zero rather than going negative', () => {
    expect(rankEntry(inputs())).toBe(0)
    // log1p(0) is 0, not -Infinity, which is the reason for using it.
    expect(rankEntry(inputs({ subscriberCount: 0, ageHours: 10_000 }))).toBe(0)
  })

  test('a future timestamp is treated as brand new, never as negative age', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    expect(ageInHours(future)).toBe(0)
    expect(ageInHours('not a date')).toBe(0)
  })

  test('age is read from the sqlite timestamp format the entries table stores', () => {
    const from = Date.parse('2026-08-05T12:00:00Z')
    expect(ageInHours('2026-08-05 09:00:00', from)).toBeCloseTo(3, 5)
  })
})

describe('discover excerpts', () => {
  test('a short body is returned whole, with no ellipsis implying more', () => {
    expect(excerptOf('Just a short post.')).toBe('Just a short post.')
  })

  test('a long body is cut on a word boundary and ellipsised', () => {
    const excerpt = excerptOf('word '.repeat(200), 50)
    expect(excerpt.length).toBeLessThanOrEqual(51)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt).not.toContain('wor…')
  })

  test('whitespace is collapsed so a feed row cannot be padded with newlines', () => {
    expect(excerptOf('one\n\n\n   two')).toBe('one two')
  })
})

describe('opentimes as a publishing target', () => {
  test('it is a registered crosspost provider like any other network', () => {
    const providers = crosspostProviders()
    expect(providers).toContain('opentimes')
    expect(providers).toContain('bluesky')
    // Ours is first, which is the order the composer selects by default.
    expect(providers[0]).toBe('opentimes')
  })

  test('per-network variants can target it, so it is not a second-class provider', () => {
    expect(sanitizeVariants({ opentimes: 'A version for our own feed' }))
      .toEqual({ opentimes: 'A version for our own feed' })
  })
})

describe('publication slugs', () => {
  test('a name becomes a url-safe slug', () => {
    expect(slugify('The Weekly Build')).toBe('the-weekly-build')
    expect(slugify('  Margins!  ')).toBe('margins')
  })

  test('a name with nothing slug-able still produces a usable slug', () => {
    expect(slugify('!!!')).toBe('publication')
    expect(slugify('')).toBe('publication')
  })
})
