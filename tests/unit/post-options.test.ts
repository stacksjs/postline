import { describe, expect, test } from 'bun:test'
import { readPostOptions, sanitizePostOptions } from '../../app/Support/Social/post-options'
import { threadSegmentContent } from '../../app/Support/Social/threads'

const from = (fields: Record<string, unknown>) => (key: string) => fields[key]

describe('reading a post\'s options', () => {
  test('nothing set is nothing stored', () => {
    expect(readPostOptions(from({}))).toEqual({ ok: true, options: undefined })
    expect(readPostOptions(from({ language: '', mastodon_visibility: 'public', mastodon_spoiler: '  ' }))).toEqual({ ok: true, options: undefined })
  })

  test('a language, a visibility and a content warning', () => {
    expect(readPostOptions(from({ language: 'pt-BR', mastodon_visibility: 'unlisted', mastodon_spoiler: 'Film ending' }))).toEqual({
      ok: true,
      options: { language: 'pt-BR', mastodon: { visibility: 'unlisted', spoilerText: 'Film ending' } },
    })
  })

  test('nonsense is refused with a reason', () => {
    expect(readPostOptions(from({ language: 'english' }))).toEqual({ ok: false, error: '"english" is not a language code Postline knows, such as en or pt-BR.' })
    expect(readPostOptions(from({ mastodon_visibility: 'everyone' })).ok).toBe(false)
    expect(readPostOptions(from({ mastodon_spoiler: 'x'.repeat(501) })).ok).toBe(false)
  })

  test('stored options are checked again on the way out', () => {
    expect(sanitizePostOptions({ language: 'de', mastodon: { visibility: 'private' } })).toEqual({ language: 'de', mastodon: { visibility: 'private' } })
    expect(sanitizePostOptions({ language: 'not a code' })).toBeUndefined()
    expect(sanitizePostOptions('junk')).toBeUndefined()
  })
})

describe('a thread\'s options', () => {
  test('every segment carries them, so a reply cannot drop a content warning', () => {
    const options = { language: 'en', mastodon: { spoilerText: 'Spoilers' } }
    const chain = { root: { uri: '1', cid: '1' }, parent: { uri: '1', cid: '1' } }
    expect(threadSegmentContent(1, { options }, chain)).toEqual({ reply: chain, options })
    expect(threadSegmentContent(1, { options }, undefined)).toEqual({ options })
    expect(threadSegmentContent(1, {}, undefined)).toBeUndefined()
  })
})
