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

  test('3 MB is too big for Bluesky and fine for X: the 1 MB cap is not everyone\'s', () => {
    expect(mediaObjections(['bluesky', 'twitter'], [{ bytes: 3 * MB, mimeType: 'image/jpeg' }])).toEqual([
      'This image is 3 MB; Bluesky takes up to 1 MB.',
    ])
    expect(mediaObjections(['twitter', 'mastodon'], [{ bytes: 3 * MB, mimeType: 'image/jpeg' }])).toEqual([])
  })

  test('four images: allowed where four are sent, refused clearly where one is', () => {
    const four = Array.from({ length: 4 }, () => ({ bytes: 200_000, mimeType: 'image/jpeg' }))
    expect(mediaObjections(['bluesky', 'twitter', 'mastodon'], four)).toEqual([])
    expect(mediaObjections(['linkedin'], four)).toEqual(['LinkedIn takes one image per post; this post has 4.'])
    expect(mediaObjections(['bluesky'], [...four, four[0]!])).toEqual(['Bluesky takes up to 4 images per post; this post has 5.'])
  })

  test('each image is named when there are several', () => {
    expect(mediaObjections(['threads'], [{ bytes: 100, mimeType: 'image/webp' }])).toEqual(['Threads takes JPEG or PNG only; this image is a WebP.'])
    expect(mediaObjections(['bluesky'], [{ bytes: 100, mimeType: 'image/jpeg' }, { bytes: 2 * MB, mimeType: 'image/jpeg' }])).toEqual([
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
