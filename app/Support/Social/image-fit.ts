/**
 * Fit an image to what a network takes, instead of refusing it.
 *
 * A 3 MB photo is fine on X and too big for Bluesky; a PNG is fine almost
 * everywhere and refused by Instagram. Rather than tell the owner to go and
 * resize it, the image is converted for the network that needs it: shrunk
 * and re-encoded as JPEG until it is under that network's limit. The original
 * is untouched and every other network still gets it as it was.
 *
 * Done with ts-images (decode, resize, encode), in-process, with no native
 * dependency. Animated GIFs are left alone: re-encoding would keep only the
 * first frame, which is a different post from the one the owner made.
 */
import type { MediaRule } from './media-rules'
import { decode, encode, resize } from 'ts-images'

export interface ImageBytes {
  bytes: Uint8Array
  mimeType: string
}

export interface FittedImage extends ImageBytes {
  /** True when the image had to be converted for this network. */
  changed: boolean
}

/** The longest side a converted image keeps; every network shows less. */
const MAX_SIDE = 4096
/** Re-encode steps: quality first, then size, so a photo keeps its detail where it can. */
const QUALITIES = [86, 78, 70] as const
const SHRINK = 0.8
const MAX_ROUNDS = 10

/** Whether an image already suits a network as it is. */
export function suits(image: ImageBytes, rule: MediaRule): boolean {
  return rule.formats.includes(image.mimeType) && image.bytes.length <= rule.maxBytes
}

/** Paint any transparency onto white: JPEG has no alpha, and would show it black. */
function flattenOntoWhite(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]! / 255
    if (alpha >= 1) continue
    data[i] = Math.round(data[i]! * alpha + 255 * (1 - alpha))
    data[i + 1] = Math.round(data[i + 1]! * alpha + 255 * (1 - alpha))
    data[i + 2] = Math.round(data[i + 2]! * alpha + 255 * (1 - alpha))
    data[i + 3] = 255
  }
}

/**
 * The image as `rule` will take it. Returns it unchanged when it already
 * suits; otherwise a JPEG under the size limit. Throws when it cannot be
 * made to fit (an animated GIF, or one that will not shrink far enough).
 */
export async function fitImage(image: ImageBytes, rule: MediaRule, network = 'This network'): Promise<FittedImage> {
  if (suits(image, rule)) return { ...image, changed: false }
  if (image.mimeType === 'image/gif')
    throw new Error(`${network} cannot take this GIF as it is, and converting it would lose its animation. Use a smaller GIF or a still image.`)
  if (!rule.formats.includes('image/jpeg'))
    throw new Error(`${network} does not take this kind of image.`)

  const decoded = await decode(image.bytes, { applyOrientation: true })
  let current = decoded
  const longest = Math.max(decoded.width, decoded.height)
  if (longest > MAX_SIDE) {
    const scale = MAX_SIDE / longest
    current = resize(decoded, { width: Math.round(decoded.width * scale), height: Math.round(decoded.height * scale), kernel: 'lanczos3' })
  }
  flattenOntoWhite(current.data as Uint8ClampedArray)

  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (const quality of QUALITIES) {
      const bytes = await encode(current, 'jpeg', { quality })
      if (bytes.length <= rule.maxBytes) return { bytes, mimeType: 'image/jpeg', changed: true }
    }
    const width = Math.round(current.width * SHRINK)
    const height = Math.round(current.height * SHRINK)
    if (width < 320 || height < 320) break
    current = resize(current, { width, height, kernel: 'bilinear' })
  }

  throw new Error(`${network} takes images up to ${Math.round(rule.maxBytes / 1_000_000 * 10) / 10} MB, and this one would not shrink that far without losing too much.`)
}
