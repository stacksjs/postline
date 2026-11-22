/**
 * The image a request attaches to a post: either an upload or an address.
 *
 * One place decides what is acceptable, so the three actions that take an
 * image (save, update, publish now) cannot drift apart. An upload is judged by
 * its bytes, never by the type the browser claimed. An address is vetted the
 * moment it is submitted, so a post never sits in the queue pointing somewhere
 * a driver must not be sent.
 */
import { assertPublicHttpUrl, safeFetch, UnsafeUrlError } from '../Http/safe-fetch'
import { readUploadedImage } from './uploads'

/** Larger than any network accepts; each network's own limit is checked at publish. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/** Identify an image from its first bytes. */
export function sniffImageType(bytes: Uint8Array): ImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
    return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47)
    return 'image/png'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return null
}

export type ImageCheck
  = | { ok: true, bytes: Uint8Array, mimeType: ImageMimeType }
    | { ok: false, error: string }

export function checkImageBytes(bytes: Uint8Array): ImageCheck {
  if (bytes.byteLength > MAX_IMAGE_BYTES)
    return { ok: false, error: `That image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` }

  const mimeType = sniffImageType(bytes)
  if (!mimeType)
    return { ok: false, error: 'That file is not a JPEG, PNG, GIF or WebP image.' }

  return { ok: true, bytes, mimeType }
}

export type ImageInput
  = | { ok: true, uploaded: { bytes: Uint8Array, mimeType: ImageMimeType } | null, url: string }
    | { ok: false, error: string }

interface ImageRequest {
  get: (key: string) => unknown
  file?: (key: string) => unknown
}

/** Read and vet the `image` upload and the `image_url` field of a request. */
export async function readImageInput(request: ImageRequest): Promise<ImageInput> {
  const raw = await readUploadedImage(request.file?.('image'))
  let uploaded: { bytes: Uint8Array, mimeType: ImageMimeType } | null = null
  if (raw) {
    const checked = checkImageBytes(raw.bytes)
    if (!checked.ok)
      return checked
    uploaded = { bytes: checked.bytes, mimeType: checked.mimeType }
  }

  const url = String(request.get('image_url') || '').trim()
  if (url) {
    try {
      await assertPublicHttpUrl(url)
    }
    catch (error) {
      return { ok: false, error: error instanceof UnsafeUrlError ? `Image address: ${error.message}` : 'That image address cannot be used.' }
    }
  }

  return { ok: true, uploaded, url }
}

/**
 * Download an image a post refers to by address. Returns null when it cannot
 * be fetched or is not an image; the caller decides what a missing image means.
 */
export async function fetchRemoteImage(url: string): Promise<{ bytes: Uint8Array, mimeType: ImageMimeType } | null> {
  try {
    const result = await safeFetch(url, { timeoutMs: 15_000, maxBytes: MAX_IMAGE_BYTES })
    if (result.status < 200 || result.status >= 300 || result.truncated)
      return null
    const checked = checkImageBytes(result.bytes)
    return checked.ok ? { bytes: checked.bytes, mimeType: checked.mimeType } : null
  }
  catch {
    return null
  }
}
