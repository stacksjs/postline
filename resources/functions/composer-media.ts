import { MAX_IMAGE_BYTES, MAX_POST_IMAGES, mediaObjections, POST_IMAGE_FORMATS } from '../../app/Support/Social/media-rules'

export interface ComposerImage {
  id: string
  file: File | null
  name: string
  alt: string
  preview?: string
  kept?: boolean
}

export const composerImageTypes = POST_IMAGE_FORMATS.join(',')

export function composerFileError(files: readonly File[], currentCount: number): string {
  if (currentCount + files.length > MAX_POST_IMAGES)
    return `A post can carry up to ${MAX_POST_IMAGES} images. Remove one first.`
  const invalid = files.find(file => !file.size || (file.type && !POST_IMAGE_FORMATS.includes(file.type)))
  if (invalid) return `${invalid.name} could not be attached. Choose a JPEG, PNG, WebP, or GIF image.`
  const oversized = files.find(file => file.size > MAX_IMAGE_BYTES)
  return oversized ? `${oversized.name} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` : ''
}

export function composerMediaWarnings(networks: readonly string[], images: readonly ComposerImage[]): string[] {
  return mediaObjections(networks, images.flatMap(image => image.file ? [{ bytes: image.file.size, mimeType: image.file.type }] : []))
}

export function composerImageFiles(images: readonly ComposerImage[]): Array<{ file: File, alt: string }> {
  return images.flatMap(image => image.file ? [{ file: image.file, alt: image.alt.trim() }] : [])
}

export function appendComposerImages(form: FormData, images: readonly ComposerImage[]): number {
  const files = composerImageFiles(images)
  for (const { file } of files) form.append('images', file, file.name)
  if (files.length) form.set('image_alts', JSON.stringify(files.map(entry => entry.alt)))
  return files.length
}
