import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { featureTest } from '@stacksjs/testing'
import { removeMediaFiles, storeAttachments } from '../../app/Support/Social/stored-attachments'
import { hydrateStoredContent } from '../../app/Support/Social/stored-content'
import { buildMediaUrl, canFetchMedia, isSafeMediaFilename, mediaContentType, mediaDirectory, persistTempMedia, removeTempMedia } from '../../app/Support/Social/uploads'

const appKey = `base64:${randomBytes(32).toString('base64')}`
const issuedAt = Date.UTC(2026, 10, 28)

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
  test.each([
    'https://posts.example.com',
    'https://posts.example.com/api',
    'posts.example.com',
    'https://posts.example.com//',
  ])('builds a signed API URL from %s', (base) => {
    const url = new URL(buildMediaUrl(base, 'a.jpg', appKey, issuedAt)!)
    expect(url.origin + url.pathname).toBe('https://posts.example.com/api/postline/media')
    expect(url.searchParams.get('file')).toBe('a.jpg')
    const expires = url.searchParams.get('expires')!
    const signature = url.searchParams.get('signature')!
    expect(Number(expires) - issuedAt / 1000).toBe(1800)
    expect(canFetchMedia('a.jpg', expires, signature, appKey, issuedAt)).toBe(true)
  })

  test('requires a base, safe filename, and a full-length app key', () => {
    expect(buildMediaUrl('', 'a.jpg', appKey)).toBeNull()
    expect(buildMediaUrl('   ', 'a.jpg', appKey)).toBeNull()
    expect(buildMediaUrl('https://posts.example.com', '../../etc/passwd', appKey)).toBeNull()
    expect(buildMediaUrl('https://posts.example.com', 'sub/dir.jpg', appKey)).toBeNull()
    expect(buildMediaUrl('https://posts.example.com', 'a.jpg', undefined)).toBeNull()
    expect(buildMediaUrl('https://posts.example.com', 'a.jpg', 'base64:1234567890')).toBeNull()
  })
})

describe('provider media access', () => {
  test('binds the signature to the image, deadline, and app key', () => {
    const url = new URL(buildMediaUrl('https://posts.example.com', 'a.jpg', appKey, issuedAt)!)
    const expires = url.searchParams.get('expires')!
    const signature = url.searchParams.get('signature')!
    expect(canFetchMedia('a.jpg', expires, signature, appKey, issuedAt + 1799_000)).toBe(true)
    expect(canFetchMedia('a.jpg', expires, signature, appKey, issuedAt + 1800_000)).toBe(false)
    expect(canFetchMedia('b.jpg', expires, signature, appKey, issuedAt)).toBe(false)
    expect(canFetchMedia('a.jpg', String(Number(expires) + 1), signature, appKey, issuedAt)).toBe(false)
    expect(canFetchMedia('a.jpg', expires, signature, randomBytes(32).toString('hex'), issuedAt)).toBe(false)
  })

  test('serves queued and temporary uploads over their signed publishing URLs', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64')
    const media = await storeAttachments(crypto.randomUUID(), [{ bytes, mimeType: 'image/png' }])
    const previousBase = process.env.STORAGE_PUBLIC_URL
    let temporary: Awaited<ReturnType<typeof persistTempMedia>> = null
    process.env.STORAGE_PUBLIC_URL = 'https://posts.example.com'
    try {
      const queued = await hydrateStoredContent(JSON.stringify({ media }))
      temporary = await persistTempMedia(bytes, 'image/png')
      const client = featureTest()
      for (const address of [queued?.media?.[0]?.url, temporary?.url]) {
        expect(address).toBeDefined()
        const url = new URL(address!)
        ;(await client.get(`${url.pathname}${url.search}`))
          .assertStatus(200)
          .assertHeader('content-type', 'image/png')
          .assertHeader('cache-control', 'private, no-store')
        ;(await client.get(`${url.pathname}?file=${url.searchParams.get('file')}`)).assertStatus(404)
      }
    }
    finally {
      if (previousBase === undefined) delete process.env.STORAGE_PUBLIC_URL
      else process.env.STORAGE_PUBLIC_URL = previousBase
      await removeMediaFiles(media)
      if (temporary) await removeTempMedia(temporary.filename)
    }
  })
})

describe('mediaDirectory', () => {
  test('sits under the working directory when nothing is configured', () => {
    expect(mediaDirectory({}, '/srv/app/current')).toBe('/srv/app/current/storage/app/postline-media')
  })

  test('is wherever POSTLINE_MEDIA_DIR says, so it can outlive a release', () => {
    expect(mediaDirectory({ POSTLINE_MEDIA_DIR: '/var/lib/postline/media' }, '/srv/app/releases/42')).toBe('/var/lib/postline/media')
  })

  test('resolves a relative setting against the working directory', () => {
    expect(mediaDirectory({ POSTLINE_MEDIA_DIR: '../shared/media' }, '/srv/app/current')).toBe('/srv/app/shared/media')
  })

  test('ignores an empty setting', () => {
    expect(mediaDirectory({ POSTLINE_MEDIA_DIR: '  ' }, '/srv/app')).toBe('/srv/app/storage/app/postline-media')
  })
})
