import { describe, expect, test } from 'bun:test'
import { buildMediaUrl, isSafeMediaFilename, mediaContentType } from '../../app/Support/Social/uploads'

describe('isSafeMediaFilename', () => {
  test('accepts the UUID basenames QueueService writes', () => {
    expect(isSafeMediaFilename('9f8c2e1a-1234-4abc-9def-0123456789ab.jpg')).toBe(true)
    expect(isSafeMediaFilename('9f8c2e1a-1234-4abc-9def-0123456789ab-1a2b3c4d.png')).toBe(true)
    expect(isSafeMediaFilename('photo123.webp')).toBe(true)
  })

  test('rejects path traversal and separators', () => {
    expect(isSafeMediaFilename('../secret.jpg')).toBe(false)
    expect(isSafeMediaFilename('..%2Fsecret.jpg')).toBe(false)
    expect(isSafeMediaFilename('sub/dir/photo.jpg')).toBe(false)
    expect(isSafeMediaFilename('/etc/passwd')).toBe(false)
    expect(isSafeMediaFilename('photo.jpg/../../x')).toBe(false)
  })

  test('rejects missing extension, empty, and non-strings', () => {
    expect(isSafeMediaFilename('noextension')).toBe(false)
    expect(isSafeMediaFilename('')).toBe(false)
    expect(isSafeMediaFilename('.hidden')).toBe(false)
    expect(isSafeMediaFilename(undefined as unknown as string)).toBe(false)
  })
})

describe('mediaContentType', () => {
  test('maps known image extensions', () => {
    expect(mediaContentType('a.jpg')).toBe('image/jpeg')
    expect(mediaContentType('a.jpeg')).toBe('image/jpeg')
    expect(mediaContentType('a.PNG')).toBe('image/png')
    expect(mediaContentType('a.gif')).toBe('image/gif')
    expect(mediaContentType('a.webp')).toBe('image/webp')
  })

  test('falls back to octet-stream for unknown extensions', () => {
    expect(mediaContentType('a.bin')).toBe('application/octet-stream')
  })
})

describe('buildMediaUrl', () => {
  test('builds a media URL from an https base', () => {
    expect(buildMediaUrl('https://posts.example.com', 'a.jpg'))
      .toBe('https://posts.example.com/postline/media?file=a.jpg')
  })

  test('adds https:// when the base has no scheme, and strips trailing slashes', () => {
    expect(buildMediaUrl('posts.example.com', 'a.jpg'))
      .toBe('https://posts.example.com/postline/media?file=a.jpg')
    expect(buildMediaUrl('https://posts.example.com//', 'a.jpg'))
      .toBe('https://posts.example.com/postline/media?file=a.jpg')
  })

  test('returns null when the base is empty', () => {
    expect(buildMediaUrl('', 'a.jpg')).toBeNull()
    expect(buildMediaUrl('   ', 'a.jpg')).toBeNull()
  })

  test('returns null (never a traversing URL) for an unsafe filename', () => {
    expect(buildMediaUrl('https://posts.example.com', '../../etc/passwd')).toBeNull()
    expect(buildMediaUrl('https://posts.example.com', 'sub/dir.jpg')).toBeNull()
  })
})
