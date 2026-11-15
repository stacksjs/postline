import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { env } from '@stacksjs/env'

/** Uploaded images for queued posts live here until publish. */
export const MEDIA_DIR = join(process.cwd(), 'storage/app/postline-media')

/**
 * Read an uploaded image regardless of shape: the router's multipart
 * parser stores raw Web `File` objects on `request.files`, while the
 * typed `FileInfo` contract (`buffer`/`mimetype`) describes the upload
 * middleware's processed form. Accept both.
 */
export async function readUploadedImage(uploaded: unknown): Promise<{ bytes: Uint8Array, mimeType: string } | null> {
  if (!uploaded || typeof uploaded !== 'object') return null
  const candidate = uploaded as { buffer?: ArrayBuffer, mimetype?: string, type?: string, arrayBuffer?: () => Promise<ArrayBuffer> }

  if (candidate.buffer && candidate.buffer.byteLength > 0)
    return { bytes: new Uint8Array(candidate.buffer), mimeType: candidate.mimetype || 'image/jpeg' }

  if (typeof candidate.arrayBuffer === 'function') {
    const buffer = await candidate.arrayBuffer()
    if (buffer.byteLength > 0)
      return { bytes: new Uint8Array(buffer), mimeType: candidate.type || 'image/jpeg' }
  }

  return null
}

/**
 * A stored media filename is safe to serve only when it's a bare basename with
 * an extension and no path separators or `..` — i.e. exactly the shape
 * QueueService writes (`<uuid>.<ext>` / `<uuid>-<hex>.<ext>`). This is the
 * traversal guard for the public media route; anything else is rejected.
 */
export function isSafeMediaFilename(name: string): boolean {
  return typeof name === 'string' && /^[\w-]+\.[a-z0-9]+$/i.test(name)
}

/** Map a media filename extension to a content type for inline serving. */
export function mediaContentType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    default: return 'application/octet-stream'
  }
}

/**
 * Pure URL builder: given a public base and a stored filename, produce the
 * media URL a remote platform fetches — or null when the base is empty or the
 * filename is unsafe. Split out from `publicMediaUrl` so the URL shape is
 * unit-testable without touching env.
 */
export function buildMediaUrl(base: string, filename: string): string | null {
  if (!isSafeMediaFilename(filename)) return null
  const raw = String(base || '').trim()
  if (!raw) return null

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const normalized = withScheme.replace(/\/+$/, '')
  return `${normalized}/postline/media?file=${encodeURIComponent(filename)}`
}

/**
 * The public URL Instagram/Threads fetch (via the Meta Graph API) for a stored
 * media file. Meta pulls the image server-side, so it must be reachable over
 * the public internet — returns null when no public base is configured
 * (`STORAGE_PUBLIC_URL` or `APP_URL`), in which case callers fall back to
 * byte-upload providers only.
 */
export function publicMediaUrl(filename: string): string | null {
  return buildMediaUrl(String(env.STORAGE_PUBLIC_URL || env.APP_URL || ''), filename)
}

/** Whether a public base is configured — i.e. whether URL-only providers can be
 *  handed a fetchable image URL at all. */
export function hasPublicMediaBase(): boolean {
  return Boolean(String(env.STORAGE_PUBLIC_URL || env.APP_URL || '').trim())
}

/**
 * Persist uploaded bytes under a fresh name so a URL-only provider (Instagram/
 * Threads) can fetch them during an immediate publish, returning the file's
 * public URL. Returns null when no public base is configured (nothing is
 * written — there'd be no fetchable URL). The caller MUST `removeTempMedia` the
 * returned filename once publishing finishes.
 */
export async function persistTempMedia(bytes: Uint8Array, mimeType?: string): Promise<{ filename: string, url: string } | null> {
  if (!hasPublicMediaBase()) return null

  const ext = (mimeType || 'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg'
  const filename = `tmp-${crypto.randomUUID()}.${ext}`
  await mkdir(MEDIA_DIR, { recursive: true })
  await Bun.write(join(MEDIA_DIR, filename), bytes)

  const url = publicMediaUrl(filename)
  if (!url) {
    await removeTempMedia(filename)
    return null
  }
  return { filename, url }
}

/** Delete a file previously written by `persistTempMedia`. Never throws. */
export async function removeTempMedia(filename: string): Promise<void> {
  if (!isSafeMediaFilename(filename)) return
  await unlink(join(MEDIA_DIR, filename)).catch(() => {})
}
