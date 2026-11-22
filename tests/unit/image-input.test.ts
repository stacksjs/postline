import { describe, expect, test } from 'bun:test'
import { checkImageBytes, MAX_IMAGE_BYTES, readImageInput, sniffImageType } from '../../app/Support/Social/image-input'

const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0])
const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

function request(fields: Record<string, unknown>, file?: unknown) {
  return { get: (key: string) => fields[key], file: (key: string) => (key === 'image' ? file : undefined) }
}

describe('sniffImageType', () => {
  test('recognises the four accepted formats by their bytes', () => {
    expect(sniffImageType(jpeg)).toBe('image/jpeg')
    expect(sniffImageType(png)).toBe('image/png')
    expect(sniffImageType(gif)).toBe('image/gif')
    expect(sniffImageType(webp)).toBe('image/webp')
  })

  test('recognises nothing else', () => {
    expect(sniffImageType(html)).toBeNull()
    expect(sniffImageType(svg)).toBeNull()
    expect(sniffImageType(new Uint8Array())).toBeNull()
  })
})

describe('checkImageBytes', () => {
  test('refuses a file over the size limit', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
    big.set(jpeg)

    expect(checkImageBytes(big).ok).toBe(false)
  })

  test('accepts a file at the limit', () => {
    const atLimit = new Uint8Array(MAX_IMAGE_BYTES)
    atLimit.set(png)

    expect(checkImageBytes(atLimit).ok).toBe(true)
  })
})

describe('readImageInput', () => {
  test('ignores the type the upload claims and uses its bytes', async () => {
    const input = await readImageInput(request({}, { buffer: png.buffer, mimetype: 'image/jpeg' }))

    expect(input).toMatchObject({ ok: true, uploaded: { mimeType: 'image/png' } })
  })

  test('refuses an upload that only claims to be an image', async () => {
    const input = await readImageInput(request({}, { buffer: html.buffer, mimetype: 'image/png' }))

    expect(input.ok).toBe(false)
  })

  test('refuses an svg upload', async () => {
    const input = await readImageInput(request({}, { buffer: svg.buffer, mimetype: 'image/svg+xml' }))

    expect(input.ok).toBe(false)
  })

  test.each([
    'http://127.0.0.1:3008/api/postline/queue',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost/x.png',
    'file:///etc/passwd',
  ])('refuses the image address %s', async (url) => {
    const input = await readImageInput(request({ image_url: url }))

    expect(input.ok).toBe(false)
  })

  test('accepts a request with no image at all', async () => {
    const input = await readImageInput(request({}))

    expect(input).toEqual({ ok: true, uploaded: null, url: '' })
  })
})
