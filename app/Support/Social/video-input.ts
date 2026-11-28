import { workspaceLocale } from '../Localization/workspace'
import { composerMediaText } from './media-messages'
import type { PostVideo } from '@stacksjs/socials'
import type { PostOptions } from './post-options'
import { UserFacingError } from '../Http/user-error'
import { MAX_VIDEO_BYTES, videoObjection } from './media-rules'
import { readUploadedMedia } from './uploads'

const text = composerMediaText(workspaceLocale)

interface VideoRequest {
  get: (key: string) => unknown
  file?: (key: string) => unknown
  getFiles?: (key: string) => unknown[]
}

interface MediaBox {
  type: string
  data: number
  end: number
}

const MP4_BRAND = /^(?:isom|iso[2-9]|mp4[12]|avc1|dash|M4V )$/

function codeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
}

/** Read complete ISO media boxes within their enclosing bounds. */
function* mediaBoxes(bytes: Uint8Array, start: number, end: number): Generator<MediaBox> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = start
  while (offset + 8 <= end) {
    const size = view.getUint32(offset)
    const type = codeAt(bytes, offset + 4)
    const header = size === 1 ? 16 : 8
    if (offset + header > end) return
    const length = size === 1 ? Number(view.getBigUint64(offset + 8)) : size || end - offset
    if (!Number.isSafeInteger(length) || length < header || length > end - offset) return
    yield { type, data: offset + header, end: offset + length }
    offset += length
  }
}

function hasVideoTrack(bytes: Uint8Array, moov: MediaBox): boolean {
  for (const track of mediaBoxes(bytes, moov.data, moov.end)) {
    if (track.type !== 'trak') continue
    for (const media of mediaBoxes(bytes, track.data, track.end)) {
      if (media.type !== 'mdia') continue
      for (const box of mediaBoxes(bytes, media.data, media.end)) {
        // The handler type follows the version, flags and predefined field.
        if (box.type === 'hdlr' && box.data + 12 <= box.end && codeAt(bytes, box.data + 8) === 'vide')
          return true
      }
    }
  }
  return false
}

export type VideoCheck = { ok: true, video: PostVideo } | { ok: false, error: string }

export function checkVideoBytes(bytes: Uint8Array, altText?: string): VideoCheck {
  if (bytes.byteLength > MAX_VIDEO_BYTES)
    return { ok: false, error: text('videoTooLarge', { limit: MAX_VIDEO_BYTES / 1024 / 1024 }) }

  let compatible = false
  let media = false
  let videoTrack = false
  for (const box of mediaBoxes(bytes, 0, bytes.length)) {
    if (box.type === 'ftyp' && box.data + 8 <= box.end) {
      const major = codeAt(bytes, box.data)
      compatible ||= MP4_BRAND.test(major)
      // The minor version follows the major brand. Check compatible brands
      // for encoders that pick another major brand for their MP4 profile.
      if (major !== 'qt  ' && !compatible) {
        for (let brand = box.data + 8; brand + 4 <= box.end; brand += 4) {
          if (MP4_BRAND.test(codeAt(bytes, brand))) {
            compatible = true
            break
          }
        }
      }
    }
    if (box.type === 'moov') videoTrack ||= hasVideoTrack(bytes, box)
    if (box.type === 'mdat' && box.end > box.data) media = true
  }
  if (!compatible || !media || !videoTrack)
    return { ok: false, error: text('invalidVideo') }

  return { ok: true, video: { bytes, mimeType: 'video/mp4', ...(altText && { altText }) } }
}

export async function readVideoInput(request: VideoRequest): Promise<VideoCheck | { ok: true, video: null }> {
  const files = request.getFiles?.('video') ?? []
  if (files.length > 1)
    return { ok: false, error: text('oneVideo') }
  const file = (files[0] ?? request.file?.('video')) as { size?: number, buffer?: ArrayBuffer } | null
  if (!file) return { ok: true, video: null }
  if ((file.size ?? file.buffer?.byteLength ?? 0) > MAX_VIDEO_BYTES)
    return { ok: false, error: text('videoTooLarge', { limit: MAX_VIDEO_BYTES / 1024 / 1024 }) }

  const raw = await readUploadedMedia(file)
  if (!raw) return { ok: false, error: text('emptyVideo') }
  const altText = String(request.get('video_alt') ?? '').trim().slice(0, 1000)
  return checkVideoBytes(raw.bytes, altText)
}

/** Validate combinations before any selected network can publish. */
export function assertVideoAllowed(providers: readonly string[], hasImages: boolean, options?: PostOptions | null): void {
  if (hasImages) throw new UserFacingError(text('mixedAttachments'))
  const unsupported = videoObjection(providers, workspaceLocale)
  if (unsupported) throw new UserFacingError(unsupported)
  if (providers.includes('mastodon') && (options?.mastodon?.poll || options?.mastodon?.quote))
    throw new UserFacingError(text('mastodonVideoOptions'))
}
