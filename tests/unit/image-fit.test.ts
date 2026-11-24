import { describe, expect, test } from 'bun:test'
import { decode, encode, getMetadata } from 'ts-images'
import { fitImage, suits } from '../../app/Support/Social/image-fit'
import { MEDIA_RULES } from '../../app/Support/Social/media-rules'

/** A busy test picture, so it does not compress to nothing. */
async function picture(width: number, height: number, format: 'png' | 'jpeg', alpha = false): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = (i * 7) % 256
    data[i * 4 + 1] = (i >> 5) % 256
    data[i * 4 + 2] = (i * 13) % 256
    data[i * 4 + 3] = alpha && i % 2 ? 0 : 255
  }
  return await encode({ width, height, data, channels: 4, bitDepth: 8, colorSpace: 'srgb', hasAlpha: alpha } as any, format, { quality: 95 })
}

describe('fitting an image to a network', () => {
  test('an image that already suits is passed through untouched', async () => {
    const bytes = await picture(200, 200, 'jpeg')
    const fitted = await fitImage({ bytes, mimeType: 'image/jpeg' }, MEDIA_RULES.bluesky!)
    expect(fitted.changed).toBe(false)
    expect(fitted.bytes).toBe(bytes)
  })

  test('a picture too large for Bluesky is shrunk under 1 MB, as a JPEG', async () => {
    const bytes = await picture(1800, 1200, 'png')
    expect(bytes.length).toBeGreaterThan(1_000_000)
    const fitted = await fitImage({ bytes, mimeType: 'image/png' }, MEDIA_RULES.bluesky!, 'Bluesky')

    expect(fitted.changed).toBe(true)
    expect(fitted.mimeType).toBe('image/jpeg')
    expect(fitted.bytes.length).toBeLessThanOrEqual(1_000_000)
    expect((await getMetadata(fitted.bytes)).format).toBe('jpeg')
    expect(suits(fitted, MEDIA_RULES.bluesky!)).toBe(true)
  }, 60_000)

  test('a PNG for a JPEG-only rule becomes a JPEG, with transparency on white', async () => {
    const bytes = await picture(40, 40, 'png', true)
    const fitted = await fitImage({ bytes, mimeType: 'image/png' }, { ...MEDIA_RULES.instagram!, converts: true })
    expect(fitted.mimeType).toBe('image/jpeg')
    const pixels = await decode(fitted.bytes)
    // The second pixel was fully transparent: it should now be close to white.
    expect(pixels.data[4]!).toBeGreaterThan(200)
    expect(pixels.data[5]!).toBeGreaterThan(200)
    expect(pixels.data[6]!).toBeGreaterThan(200)
  })

  test('a GIF is not converted: that would lose its animation', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Uint8Array(1_100_000)])
    await expect(fitImage({ bytes: gif, mimeType: 'image/gif' }, MEDIA_RULES.bluesky!, 'Bluesky')).rejects.toThrow('lose its animation')
  })
})

describe('at publish', () => {
  test('each network gets the image the way it takes it, and the others get the original', async () => {
    const { CrosspostService } = await import('../../app/Services/Social/CrosspostService')
    const { db } = await import('@stacksjs/database')
    const seen: Record<string, { mimeType?: string, size: number, alt?: string }> = {}
    const network = (provider: string) => ({
      async publishToPost(post: { id: number }, content: any) {
        const item = content?.media?.[0]
        seen[provider] = { mimeType: item?.mimeType, size: item?.bytes?.length ?? 0, alt: item?.altText }
        await (db as any).insertInto('post_targets').values({ uuid: crypto.randomUUID(), provider, status: 'published', post_id: post.id }).execute()
        return { provider, ok: true, target: provider }
      },
    })
    const original = await picture(1600, 1100, 'png')
    const service = new CrosspostService({ blog: network('blog'), bluesky: network('bluesky') } as never)

    const uuid = crypto.randomUUID()
    await (db as any).insertInto('posts').values({ uuid, title: 'fit', body: 'fit', status: 'draft', source: 'composer', timezone: 'UTC' }).execute()
    const postId = Number((await (db as any).selectFrom('posts').select(['id']).where('uuid', '=', uuid).executeTakeFirstOrThrow()).id)

    await service.publishExisting({ id: postId, body: 'fit' }, [{ provider: 'blog', identityId: null }, { provider: 'bluesky', identityId: null }] as never, { media: [{ bytes: original, mimeType: 'image/png', altText: 'a pattern' }] })

    expect(seen.blog).toEqual({ mimeType: 'image/png', size: original.length, alt: 'a pattern' })
    expect(seen.bluesky!.mimeType).toBe('image/jpeg')
    expect(seen.bluesky!.size).toBeLessThanOrEqual(1_000_000)
    expect(seen.bluesky!.alt).toBe('a pattern')
  }, 60_000)
})
