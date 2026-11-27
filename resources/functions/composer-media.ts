import { MAX_IMAGE_BYTES, MAX_POST_IMAGES, MAX_VIDEO_BYTES, mediaObjections, POST_IMAGE_FORMATS, videoObjection } from '../../app/Support/Social/media-rules'

export interface ComposerImage {
  id: string
  file: File | null
  name: string
  alt: string
  preview?: string
  kept?: boolean
  video?: boolean
}

export const composerAttachmentTypes = [...POST_IMAGE_FORMATS, 'video/mp4', '.mp4'].join(',')

export function isComposerVideo(file: File): boolean {
  return file.type === 'video/mp4' || /\.mp4$/i.test(file.name)
}

export function composerVideoError(files: readonly File[]): string {
  if (files.length !== 1) return 'Attach images or one video per post.'
  const file = files[0]!
  if (!file.size) return 'Attach a non-empty MP4 video.'
  return file.size > MAX_VIDEO_BYTES ? `${file.name} is larger than ${MAX_VIDEO_BYTES / 1024 / 1024} MB.` : ''
}

export function composerFileError(files: readonly File[], currentCount: number): string {
  if (currentCount + files.length > MAX_POST_IMAGES)
    return `A post can carry up to ${MAX_POST_IMAGES} images. Remove one first.`
  const invalid = files.find(file => !file.size || (file.type && !POST_IMAGE_FORMATS.includes(file.type)))
  if (invalid) return `${invalid.name} could not be attached. Choose a JPEG, PNG, WebP, or GIF image.`
  const oversized = files.find(file => file.size > MAX_IMAGE_BYTES)
  return oversized ? `${oversized.name} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` : ''
}

export function composerMediaWarnings(networks: readonly string[], images: readonly ComposerImage[]): string[] {
  if (images[0]?.video) {
    const objection = videoObjection(networks)
    return objection ? [objection] : []
  }
  return mediaObjections(networks, images.flatMap(image => image.file ? [{ bytes: image.file.size, mimeType: image.file.type }] : []))
}

export function composerImageFiles(images: readonly ComposerImage[]): Array<{ file: File, alt: string }> {
  return images.flatMap(image => image.file && !image.video ? [{ file: image.file, alt: image.alt.trim() }] : [])
}
