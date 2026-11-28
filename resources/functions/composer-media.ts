import { POST_IMAGE_FORMATS } from '../../app/Support/Social/media-limits'

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

export function composerImageFiles(images: readonly ComposerImage[]): Array<{ file: File, alt: string }> {
  return images.flatMap(image => image.file && !image.video ? [{ file: image.file, alt: image.alt.trim() }] : [])
}
