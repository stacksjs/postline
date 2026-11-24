import { describe, expect, test } from 'bun:test'
import { mediaObjections, tightestImageBytes } from '../../app/Support/Social/media-rules'

const MB = 1024 * 1024

describe('which network objects to an image, and why', () => {
  test('a small JPEG suits everyone', () => {
    expect(mediaObjections(['bluesky', 'twitter', 'mastodon', 'linkedin', 'instagram', 'threads', 'blog'], [{ bytes: 400_000, mimeType: 'image/jpeg' }])).toEqual([])
  })

  test('a PNG is refused for Instagram only, by name', () => {
    expect(mediaObjections(['bluesky', 'instagram', 'twitter'], [{ bytes: 400_000, mimeType: 'image/png' }])).toEqual([
      'Instagram takes JPEG only; this image is a PNG.',
    ])
  })

  test('a 3 MB photo is not refused for Bluesky: it is shrunk for Bluesky at publish', () => {
    expect(mediaObjections(['bluesky', 'twitter', 'mastodon'], [{ bytes: 3 * MB, mimeType: 'image/jpeg' }])).toEqual([])
  })

  test('a GIF too large for Bluesky is refused: converting would lose its animation', () => {
    expect(mediaObjections(['bluesky'], [{ bytes: 3 * MB, mimeType: 'image/gif' }])).toEqual([
      'This image is 3 MB; Bluesky takes up to 1 MB.',
    ])
  })

  test('four images: allowed where four are sent, refused clearly where one is', () => {
    const four = Array.from({ length: 4 }, () => ({ bytes: 200_000, mimeType: 'image/jpeg' }))
    expect(mediaObjections(['bluesky', 'twitter', 'mastodon'], four)).toEqual([])
    expect(mediaObjections(['linkedin'], four)).toEqual(['LinkedIn takes one image per post; this post has 4.'])
    expect(mediaObjections(['bluesky'], [...four, four[0]!])).toEqual(['Bluesky takes up to 4 images per post; this post has 5.'])
  })

  test('each image is named when there are several', () => {
    expect(mediaObjections(['threads'], [{ bytes: 100, mimeType: 'image/webp' }])).toEqual(['Threads takes JPEG or PNG only; this image is a WebP.'])
    expect(mediaObjections(['threads'], [{ bytes: 100, mimeType: 'image/jpeg' }, { bytes: 9 * MB, mimeType: 'image/jpeg' }])).toEqual([
      'Threads takes one image per post; this post has 2.',
    ])
    expect(mediaObjections(['bluesky'], [{ bytes: 100, mimeType: 'image/jpeg' }, { bytes: 2 * MB, mimeType: 'image/gif' }])).toEqual([
      'Image 2 is 2 MB; Bluesky takes up to 1 MB.',
    ])
  })

  test('an image given by address is not measured, and no image means no objection', () => {
    expect(mediaObjections(['bluesky', 'instagram'], [{}])).toEqual([])
    expect(mediaObjections(['instagram'], [])).toEqual([])
  })

  test('the tightest size among the chosen networks', () => {
    expect(tightestImageBytes(['twitter', 'bluesky'])).toBe(1_000_000)
    expect(tightestImageBytes(['twitter', 'mastodon'])).toBe(5 * MB)
    expect(tightestImageBytes(['blog'])).toBeNull()
  })
})
