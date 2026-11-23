import { describe, expect, test } from 'bun:test'
import { countText, exceedsLimit } from '../../app/Support/Social/count-text'

const family = '👨‍👩‍👧‍👦'
const flag = '🇩🇪'
const longUrl = `https://example.com/${'a'.repeat(120)}`

/** One table: the composer and the server both run this function. */
const samples: Array<[string, string, Record<string, number>]> = [
  ['plain text', 'Hello world', { bluesky: 11, twitter: 11, mastodon: 11, threads: 11, linkedin: 11 }],
  ['a family emoji', family, { bluesky: 1, twitter: 2, mastodon: 1, threads: 1, linkedin: family.length }],
  ['a flag', flag, { bluesky: 1, twitter: 2, mastodon: 1, threads: 1 }],
  ['an accent built from two code points', 'é', { bluesky: 1, twitter: 1, mastodon: 1 }],
  ['Japanese', 'こんにちは', { bluesky: 5, twitter: 10, mastodon: 5, threads: 5 }],
  ['a long link', `Read ${longUrl}`, { twitter: 28, mastodon: 28, bluesky: 5 + longUrl.length }],
  ['a link ending a sentence', 'See https://example.com/a.', { twitter: 4 + 23 + 1, mastodon: 4 + 23 + 1 }],
  ['a bare domain', 'Try example.com today', { twitter: 4 + 23 + 6, mastodon: 4 + 23 + 6 }],
  ['a remote mention', 'Hi @chris@example.social!', { mastodon: 10 }],
  ['curly quotes and a dash', '“ok” – fine', { twitter: 11 }],
]

describe('counting a post the way its network does', () => {
  for (const [name, text, expected] of samples) {
    for (const [provider, count] of Object.entries(expected))
      test(`${name} on ${provider}`, () => expect(countText(provider, text)).toBe(count))
  }

  test('300 emoji fit on Bluesky and do not fit in 300 UTF-16 units', () => {
    const text = '🎉'.repeat(300)
    expect(text.length).toBe(600)
    expect(exceedsLimit('bluesky', text, 300)).toBe(false)
  })

  test('141 Japanese characters are too long for X though .length says 141', () => {
    expect(exceedsLimit('twitter', 'あ'.repeat(141), 280)).toBe(true)
    expect(exceedsLimit('twitter', 'あ'.repeat(140), 280)).toBe(false)
  })

  test('a limit of zero means no limit', () => {
    expect(exceedsLimit('blog', 'x'.repeat(50_000), 0)).toBe(false)
  })
})
