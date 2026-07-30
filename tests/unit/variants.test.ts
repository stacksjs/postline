import type { PublishContent } from '../../app/Support/Social/types'
import { describe, expect, test } from 'bun:test'
import { parseVariantsField, resolveStoredVariants, resolveVariantBody, sanitizeVariants } from '../../app/Support/Social/variants'

const SHARED = 'the shared body'

describe('resolveVariantBody', () => {
  test('falls back to the shared body when no content is passed', () => {
    expect(resolveVariantBody(SHARED, 'bluesky')).toBe(SHARED)
  })

  test('falls back to the shared body when no variants are set', () => {
    const content: PublishContent = { title: 'x' }
    expect(resolveVariantBody(SHARED, 'bluesky', content)).toBe(SHARED)
  })

  test('returns the variant for the provider that has one', () => {
    const content: PublishContent = { variants: { bluesky: 'short version' } }
    expect(resolveVariantBody(SHARED, 'bluesky', content)).toBe('short version')
  })

  test('leaves every other provider on the shared body', () => {
    const content: PublishContent = { variants: { bluesky: 'short version' } }
    expect(resolveVariantBody(SHARED, 'linkedin', content)).toBe(SHARED)
    expect(resolveVariantBody(SHARED, 'threads', content)).toBe(SHARED)
    expect(resolveVariantBody(SHARED, 'blog', content)).toBe(SHARED)
  })

  test('resolves each provider independently', () => {
    const content: PublishContent = {
      variants: { bluesky: 'bsky copy', linkedin: 'a much longer professional take' },
    }
    expect(resolveVariantBody(SHARED, 'bluesky', content)).toBe('bsky copy')
    expect(resolveVariantBody(SHARED, 'linkedin', content)).toBe('a much longer professional take')
    expect(resolveVariantBody(SHARED, 'mastodon', content)).toBe(SHARED)
  })

  // A cleared override must inherit. Publishing an empty body would be a
  // silent content-loss bug rather than a fallback.
  test('an empty variant inherits rather than publishing nothing', () => {
    const content: PublishContent = { variants: { bluesky: '' } }
    expect(resolveVariantBody(SHARED, 'bluesky', content)).toBe(SHARED)
  })

  test('a whitespace-only variant inherits', () => {
    const content: PublishContent = { variants: { bluesky: '   \n  ' } }
    expect(resolveVariantBody(SHARED, 'bluesky', content)).toBe(SHARED)
  })

  test('preserves a variant that is merely short, not blank', () => {
    const content: PublishContent = { variants: { twitter: '.' } }
    expect(resolveVariantBody(SHARED, 'twitter', content)).toBe('.')
  })

  test('does not trim the variant it returns', () => {
    const content: PublishContent = { variants: { bluesky: '  padded  ' } }
    expect(resolveVariantBody(SHARED, 'bluesky', content)).toBe('  padded  ')
  })
})

describe('sanitizeVariants', () => {
  test('accepts a plain object', () => {
    expect(sanitizeVariants({ bluesky: 'a' })).toEqual({ bluesky: 'a' })
  })

  test('accepts a JSON string', () => {
    expect(sanitizeVariants('{"linkedin":"a"}')).toEqual({ linkedin: 'a' })
  })

  test('drops unknown provider keys', () => {
    expect(sanitizeVariants({ bluesky: 'a', myspace: 'b', __proto__: 'c' }))
      .toEqual({ bluesky: 'a' })
  })

  test('drops non-string values', () => {
    expect(sanitizeVariants({ bluesky: 'a', linkedin: 42, threads: null, blog: {} }))
      .toEqual({ bluesky: 'a' })
  })

  test('drops blank and whitespace-only values', () => {
    expect(sanitizeVariants({ bluesky: '', linkedin: '   ', threads: 'kept' }))
      .toEqual({ threads: 'kept' })
  })

  test('returns undefined when nothing survives', () => {
    expect(sanitizeVariants({ myspace: 'b' })).toBeUndefined()
    expect(sanitizeVariants({ bluesky: '' })).toBeUndefined()
    expect(sanitizeVariants({})).toBeUndefined()
  })

  test('returns undefined for malformed JSON rather than throwing', () => {
    expect(sanitizeVariants('{not json')).toBeUndefined()
  })

  test('returns undefined for empty, null, and non-object input', () => {
    expect(sanitizeVariants('')).toBeUndefined()
    expect(sanitizeVariants('   ')).toBeUndefined()
    expect(sanitizeVariants(null)).toBeUndefined()
    expect(sanitizeVariants(undefined)).toBeUndefined()
    expect(sanitizeVariants(42)).toBeUndefined()
  })

  test('returns undefined for arrays', () => {
    expect(sanitizeVariants(['a'])).toBeUndefined()
    expect(sanitizeVariants('["a"]')).toBeUndefined()
  })

  test('round-trips through JSON so stored blobs rehydrate unchanged', () => {
    const original = sanitizeVariants({ bluesky: 'short', linkedin: 'long' })
    expect(sanitizeVariants(JSON.stringify(original))).toEqual(original!)
  })
})

describe('parseVariantsField', () => {
  // The distinction that matters: sanitizeVariants collapses "unparseable" and
  // "explicitly empty" to the same value, and callers read that as "clear".
  // Conflating them lets a corrupt payload delete every stored override.
  test('rejects malformed JSON instead of reading it as empty', () => {
    expect(parseVariantsField('{not json')).toEqual({ ok: false })
    expect(parseVariantsField('{"bluesky":')).toEqual({ ok: false })
  })

  test('rejects non-object shapes', () => {
    expect(parseVariantsField('["a"]')).toEqual({ ok: false })
    expect(parseVariantsField('42')).toEqual({ ok: false })
    expect(parseVariantsField(['a'])).toEqual({ ok: false })
    expect(parseVariantsField(7)).toEqual({ ok: false })
  })

  test('accepts an explicitly empty submission as a clear', () => {
    expect(parseVariantsField('')).toEqual({ ok: true, variants: null })
    expect(parseVariantsField('   ')).toEqual({ ok: true, variants: null })
    expect(parseVariantsField('{}')).toEqual({ ok: true, variants: null })
    expect(parseVariantsField({})).toEqual({ ok: true, variants: null })
  })

  test('treats an all-blank map as a clear, not as a parse failure', () => {
    expect(parseVariantsField('{"bluesky":"  "}')).toEqual({ ok: true, variants: null })
  })

  test('accepts and sanitizes a well-formed submission', () => {
    expect(parseVariantsField('{"bluesky":"short","myspace":"x"}'))
      .toEqual({ ok: true, variants: { bluesky: 'short' } })
  })

  test('null and undefined mean nothing submitted', () => {
    expect(parseVariantsField(null)).toEqual({ ok: true, variants: null })
    expect(parseVariantsField(undefined)).toEqual({ ok: true, variants: null })
  })
})

describe('resolveStoredVariants', () => {
  const STORED = { bluesky: 'stored short version' }

  // The regression this whole tri-state exists to prevent: QueueService.update
  // rewrites posts.content wholesale, so an edit that does not mention variants
  // must not drop them.
  test('keeps stored variants when the field is not submitted', () => {
    expect(resolveStoredVariants(undefined, STORED)).toEqual(STORED)
  })

  test('keeps stored variants across an edit that only changes other fields', () => {
    expect(resolveStoredVariants(undefined, { bluesky: 'a', linkedin: 'b' }))
      .toEqual({ bluesky: 'a', linkedin: 'b' })
  })

  test('clears when explicitly submitted as null', () => {
    expect(resolveStoredVariants(null, STORED)).toBeUndefined()
  })

  test('replaces wholesale when an object is submitted', () => {
    expect(resolveStoredVariants({ linkedin: 'new' }, STORED)).toEqual({ linkedin: 'new' })
  })

  test('replacing drops providers absent from the new map', () => {
    const result = resolveStoredVariants({ linkedin: 'new' }, { bluesky: 'old', linkedin: 'old' })
    expect(result).toEqual({ linkedin: 'new' })
    expect(result?.bluesky).toBeUndefined()
  })

  test('an all-blank submission clears rather than keeping', () => {
    expect(resolveStoredVariants({ bluesky: '   ' }, STORED)).toBeUndefined()
  })

  test('sanitizes stored values on the keep path, so a corrupt row cannot pass through', () => {
    expect(resolveStoredVariants(undefined, { bluesky: 'ok', myspace: 'x', linkedin: 9 }))
      .toEqual({ bluesky: 'ok' })
  })

  test('returns undefined when nothing is submitted and nothing is stored', () => {
    expect(resolveStoredVariants(undefined, undefined)).toBeUndefined()
    expect(resolveStoredVariants(undefined, null)).toBeUndefined()
  })

  test('accepts a stored JSON string, matching how posts.content round-trips', () => {
    expect(resolveStoredVariants(undefined, '{"threads":"kept"}')).toEqual({ threads: 'kept' })
  })
})
