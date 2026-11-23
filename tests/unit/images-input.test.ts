import { describe, expect, test } from 'bun:test'
import { readImagesInput } from '../../app/Support/Social/image-input'

const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9])
const upload = (bytes: Uint8Array) => ({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mimetype: 'image/png' })

function request(fields: Record<string, unknown>, files: Record<string, unknown[]> = {}) {
  return {
    get: (key: string) => fields[key],
    file: (key: string) => files[key]?.[0] ?? null,
    getFiles: (key: string) => files[key] ?? [],
  }
}

describe('reading the images a request attaches', () => {
  test('several uploads, each with its alt text from the list', async () => {
    const result = await readImagesInput(request({ image_alts: JSON.stringify(['one', '', 'three']) }, { images: [upload(png), upload(png), upload(png)] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.images.map(image => image.altText)).toEqual(['one', undefined, 'three'])
    expect(result.images.every(image => image.mimeType === 'image/png')).toBe(true)
  })

  test('the single upload with image_alt still works', async () => {
    const result = await readImagesInput(request({ image_alt: 'alone' }, { image: [upload(png)] }))
    expect(result.ok && result.images.map(image => image.altText)).toEqual(['alone'])
  })

  test('a file that is not an image is refused, naming which one', async () => {
    const result = await readImagesInput(request({}, { images: [upload(png), upload(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))] }))
    expect(result).toEqual({ ok: false, error: 'Image 2: That file is not a JPEG, PNG, GIF or WebP image.' })
  })

  test('more than four is refused', async () => {
    const result = await readImagesInput(request({}, { images: Array.from({ length: 5 }, () => upload(png)) }))
    expect(result).toEqual({ ok: false, error: 'A post can carry up to 4 images; this one has 5.' })
  })

  test('no images is an empty list, not an error', async () => {
    expect(await readImagesInput(request({}))).toEqual({ ok: true, images: [] })
  })
})
