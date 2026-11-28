import { describe, expect, test } from 'bun:test'
import { mediaObjections, tightestImageBytes, videoObjection } from '../../app/Support/Social/media-rules'

const MB = 1024 * 1024

describe('which network objects to an image, and why', () => {
  test('a small JPEG suits everyone', () => {
    expect(mediaObjections(['bluesky', 'twitter', 'mastodon', 'linkedin', 'instagram', 'threads', 'blog'], [{ bytes: 400_000, mimeType: 'image/jpeg' }])).toEqual([])
  })

  test('a PNG for Instagram is not refused: it is converted to JPEG for Instagram at publish', () => {
    expect(mediaObjections(['bluesky', 'instagram', 'twitter'], [{ bytes: 400_000, mimeType: 'image/png' }])).toEqual([])
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
    expect(mediaObjections(['linkedin'], four)).toEqual([])
    expect(mediaObjections(['instagram', 'threads'], four)).toEqual([])
    expect(mediaObjections(['bluesky'], [...four, four[0]!])).toEqual(['Bluesky takes up to 4 images per post; this post has 5.'])
  })

  test('each image is named when there are several', () => {
    expect(mediaObjections(['threads'], [{ bytes: 100, mimeType: 'image/gif' }])).toEqual(['Threads takes JPEG or PNG only; this image is a GIF.'])
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

  test('formats network objections in the workspace locale', () => {
    expect(mediaObjections(['bluesky'], [{ bytes: 1.5 * MB, mimeType: 'image/gif' }], 'es')).toEqual([
      'Esta imagen ocupa 1,5 MB. Bluesky admite hasta 1 MB.',
    ])
    expect(videoObjection(['instagram', 'blog', 'blog'], 'es')).toBe(
      'No se pueden publicar videos en Instagram o Blog. Elige Bluesky o Mastodon para esta publicación.',
    )
  })
})
