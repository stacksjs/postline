import type { ComposerImage } from '../../functions/composer-media'
import { composerMediaText } from '../../../app/Support/Social/media-messages'
import { MAX_IMAGE_BYTES, MAX_POST_IMAGES, MAX_VIDEO_BYTES, POST_IMAGE_FORMATS } from '../../../app/Support/Social/media-limits'
import { mediaObjections, videoObjection } from '../../../app/Support/Social/media-rules'

let nextId = 0

function isComposerVideo(file: File): boolean {
  return file.type === 'video/mp4' || /\.mp4$/i.test(file.name)
}

function composerVideoError(files: readonly File[], locale: string): string {
  const text = composerMediaText(locale)
  if (files.length !== 1) return text('mixedAttachments')
  const file = files[0]!
  if (!file.size) return text('emptyVideo')
  return file.size > MAX_VIDEO_BYTES ? text('fileTooLarge', { file: file.name, limit: MAX_VIDEO_BYTES / 1024 / 1024 }) : ''
}

function composerFileError(files: readonly File[], currentCount: number, locale: string): string {
  const text = composerMediaText(locale)
  if (currentCount + files.length > MAX_POST_IMAGES)
    return text('imageCap', { limit: MAX_POST_IMAGES })
  const invalid = files.find(file => !file.size || (file.type && !POST_IMAGE_FORMATS.includes(file.type)))
  if (invalid) return text('couldNotAttachImage', { file: invalid.name })
  const oversized = files.find(file => file.size > MAX_IMAGE_BYTES)
  return oversized ? text('fileTooLarge', { file: oversized.name, limit: MAX_IMAGE_BYTES / 1024 / 1024 }) : ''
}

export function composerMediaWarnings(networks: readonly string[], images: readonly ComposerImage[], locale: string): string[] {
  if (images[0]?.video) {
    const objection = videoObjection(networks, locale)
    return objection ? [objection] : []
  }
  return mediaObjections(networks, images.flatMap(image => image.file ? [{ bytes: image.file.size, mimeType: image.file.type }] : []), locale)
}

export function prepareAttachments(files: readonly File[], current: readonly ComposerImage[], locale: string) {
  const video = files.some(isComposerVideo)
  const keep = video ? [] : current.filter(item => !item.kept && !item.video)
  const error = video ? composerVideoError(files, locale) : composerFileError(files, keep.length, locale)
  if (error) return { error, items: null }
  const added = files.map(file => ({
    id: String(++nextId), file, name: file.name, alt: '', preview: URL.createObjectURL(file), video,
  }))
  return { error: '', items: [...keep, ...added] }
}

export function attachmentImageRows(images: readonly ComposerImage[], locale: string) {
  const text = composerMediaText(locale)
  return images.map((image, index) => ({
    ...image,
    editable: !image.kept,
    canMoveEarlier: index > 0,
    canMoveLater: index < images.length - 1,
    altLabel: image.video ? text('videoAlt') : text('imageAlt', { number: index + 1 }),
    removeLabel: image.video ? text('removeVideo') : image.kept ? text('removeSavedImages') : text('removeFile', { file: image.name }),
    earlierLabel: text('moveEarlier', { file: image.name }),
    laterLabel: text('moveLater', { file: image.name }),
    videoLabel: image.alt || text('videoPreview'),
  }))
}
