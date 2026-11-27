import { mkdir, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { isIP } from 'node:net'
import { isPrivateAddress } from '../Http/safe-fetch'
import { env } from '@stacksjs/env'

/**
 * Where uploaded images for queued posts live until they are published.
 *
 * `POSTLINE_MEDIA_DIR` names it outright, and a hosted install must set it to
 * a directory outside the release: a deploy replaces the release folder, and
 * the API and the scheduler run from different ones, so an image written
 * under the working directory is lost on the next deploy and was never
 * visible to the process that publishes it. Unset, it sits under the working
 * directory, which is right for development and for the Mac app (whose
 * working directory is its data folder).
 */
export function mediaDirectory(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  const configured = String(env.POSTLINE_MEDIA_DIR || '').trim()
  if (configured)
    return isAbsolute(configured) ? configured : resolve(cwd, configured)
  return join(cwd, 'storage/app/postline-media')
}

export const MEDIA_DIR: string = mediaDirectory()

/**
 * Read an uploaded file regardless of shape: the router's multipart
 * parser stores raw Web `File` objects on `request.files`, while the
 * typed `FileInfo` contract (`buffer`/`mimetype`) describes the upload
 * middleware's processed form. Accept both.
 */
export async function readUploadedMedia(uploaded: unknown): Promise<{ bytes: Uint8Array, mimeType: string } | null> {
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

/** Stream an image after its caller verifies ownership and visibility. */
export async function storedImageResponse(file: string, cacheControl: string): Promise<Response | null> {
  const contentType = mediaContentType(file)
  if (!isSafeMediaFilename(file) || !contentType.startsWith('image/')) return null
  const stored = Bun.file(join(MEDIA_DIR, file))
  if (!(await stored.exists())) return null
  return new Response(stored, {
    headers: {
      'content-type': contentType,
      'content-length': String(stored.size),
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'cache-control': cacheControl,
    },
  })
}

/** Stream a queued MP4, including the single-byte ranges browsers use to seek. */
export async function storedVideoResponse(file: string, range: string | null): Promise<Response | null> {
  if (!isSafeMediaFilename(file) || !file.toLowerCase().endsWith('.mp4')) return null
  const stored = Bun.file(join(MEDIA_DIR, file))
  if (!(await stored.exists()) || !stored.size) return null

  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'content-disposition': 'inline',
    'content-type': 'video/mp4',
    'x-content-type-options': 'nosniff',
  })
  if (!range) {
    headers.set('content-length', String(stored.size))
    return new Response(stored, { headers })
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range)
  const first = match?.[1]
  const last = match?.[2]
  if (first || last) {
    const start = first ? Number(first) : Math.max(0, stored.size - Number(last))
    const end = first && last ? Math.min(stored.size - 1, Number(last)) : stored.size - 1
    if (start <= end && start < stored.size) {
      headers.set('content-range', `bytes ${start}-${end}/${stored.size}`)
      headers.set('content-length', String(end - start + 1))
      return new Response(stored.slice(start, end + 1), { headers, status: 206 })
    }
  }
  headers.set('content-range', `bytes */${stored.size}`)
  return new Response(null, { headers, status: 416 })
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
  // The route is registered as `/postline/media` in routes/api.ts, which the
  // router serves under `/api`. A base that already ends in `/api` is left as
  // it is, so an install that worked around the missing prefix still works.
  const api = /\/api$/i.test(normalized) ? normalized : `${normalized}/api`
  return `${api}/postline/media?file=${encodeURIComponent(filename)}`
}

/**
 * The public URL Instagram/Threads fetch (via the Meta Graph API) for a stored
 * media file. Meta pulls the image server-side, so it must be reachable over
 * the public internet — returns null when no public base is configured
 * (`STORAGE_PUBLIC_URL` or `APP_URL`), in which case callers fall back to
 * byte-upload providers only.
 */
export function publicMediaUrl(filename: string): string | null {
  const base = configuredMediaBase()
  return isPublicBase(base) ? buildMediaUrl(base, filename) : null
}

/**
 * Whether URL-only providers can be handed a fetchable image URL at all: a
 * base is configured AND it is an address the internet can reach. This used
 * to check presence only, so the default `APP_URL=postline.localhost` passed,
 * Meta was handed an address it could not fetch, and every Instagram post
 * failed with an error that pointed at Meta instead of at the address.
 */
export function hasPublicMediaBase(): boolean {
  return isPublicBase(configuredMediaBase())
}

function configuredMediaBase(): string {
  return String(env.STORAGE_PUBLIC_URL || env.APP_URL || '').trim()
}

/**
 * Whether a base address could be fetched from the public internet, judged
 * from the address alone: a name that only resolves on this machine or a
 * local network (`localhost`, `*.localhost`, `*.test`, `*.local`,
 * `*.internal`, a single-label name) or a private IP is not. A public-looking
 * name that is not actually served is not caught here; Meta's error says so.
 */
export function isPublicBase(base: string): boolean {
  const raw = String(base || '').trim()
  if (!raw) return false
  let host: string
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  }
  catch {
    return false
  }
  if (!host) return false
  if (isIP(host)) return !isPrivateAddress(host)
  if (!host.includes('.')) return false
  return !/(?:^|\.)(?:localhost|test|local|internal|lan|home|example|invalid)$/.test(host)
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
