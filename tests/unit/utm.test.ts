import { describe, expect, test } from 'bun:test'
import { publicShortLinkOrigin } from '../../app/Services/TrackedLinkService'
import { addUtmParameters } from '../../app/Support/Social/utm'

describe('tagged web addresses', () => {
  test('sets selected tags while keeping query values, existing tags, and the fragment', () => {
    const url = new URL(addUtmParameters('https://example.org/story?q=one&q=two&utm_medium=social&utm_source=old#notes', {
      source: ' Bluesky ', campaign: 'Autumn & winter', content: '日本語', medium: '',
    }))
    expect(url.searchParams.getAll('q')).toEqual(['one', 'two'])
    expect(url.searchParams.getAll('utm_source')).toEqual(['Bluesky'])
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe('Autumn & winter')
    expect(url.searchParams.get('utm_content')).toBe('日本語')
    expect(url.hash).toBe('#notes')
  })

  test('accepts HTTP and HTTPS addresses without embedded credentials', () => {
    expect(addUtmParameters('http://example.org/', {})).toBe('http://example.org/')
    expect(() => addUtmParameters('file:///tmp/notes', {})).toThrow('HTTP or HTTPS')
    expect(() => addUtmParameters('https://name:password@example.org/', {})).toThrow('without a username or password')
    expect(() => addUtmParameters('https://example.org', { campaign: 'a'.repeat(121) })).toThrow('120 characters')
  })

  test('short links use a configured public HTTPS app origin', () => {
    expect(publicShortLinkOrigin('https://workspace.example.org/analytics')).toBe('https://workspace.example.org')
    expect(publicShortLinkOrigin('https://postline.localhost')).toBeNull()
    expect(publicShortLinkOrigin('https://postline.localhost.')).toBeNull()
    expect(publicShortLinkOrigin('https://192.168.1.4')).toBeNull()
    expect(publicShortLinkOrigin('http://workspace.example.org')).toBeNull()
  })
})
