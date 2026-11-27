import type { PublishContent } from './types'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { UserFacingError } from '../Http/user-error'
import { checkImageBytes, fetchRemoteImage } from './image-input'
import { MAX_POST_IMAGES } from './media-rules'
import { MEDIA_DIR } from './uploads'

export interface BlogAttachment {
  file: string
  alt: string
}

export function isBlogAttachmentFile(file: string): boolean {
  return /^blog-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpeg|png|webp|gif)$/.test(file)
}

export function readBlogAttachments(value: unknown): BlogAttachment[] {
  if (value === undefined || value === null || value === '') return []
  const entries: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(entries) || entries.length > MAX_POST_IMAGES) throw new Error('Invalid Blog attachments.')
  return entries.map((entry) => {
    if (typeof entry?.file !== 'string' || !isBlogAttachmentFile(entry.file) || typeof entry.alt !== 'string')
      throw new Error('Invalid Blog attachment reference.')
    return { file: entry.file, alt: entry.alt.trim().slice(0, 1000) }
  })
}

export async function removeBlogAttachments(attachments: readonly BlogAttachment[]): Promise<void> {
  for (const item of attachments) {
    if (!isBlogAttachmentFile(item.file)) continue
    await unlink(join(MEDIA_DIR, item.file)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

/** Promote attached images into files owned by the article, separate from the queue. */
export async function saveBlogAttachments(images: NonNullable<PublishContent['media']>): Promise<BlogAttachment[]> {
  if (!images.length) return []
  if (images.length > MAX_POST_IMAGES) throw new UserFacingError(`An article can have at most ${MAX_POST_IMAGES} images.`)

  const ready = await Promise.all(images.map(async (image, index) => {
    const checked = image.bytes?.length ? checkImageBytes(image.bytes) : image.url ? await fetchRemoteImage(image.url) : null
    if (!checked || !('bytes' in checked)) throw new UserFacingError(`Image ${index + 1} could not be attached to the Blog. Check the image or its address.`)
    const extension = checked.mimeType.split('/')[1]
    return {
      attachment: { file: `blog-${crypto.randomUUID()}.${extension}`, alt: image.altText?.trim().slice(0, 1000) ?? '' },
      bytes: checked.bytes,
    }
  }))

  await mkdir(MEDIA_DIR, { recursive: true })
  const written: BlogAttachment[] = []
  try {
    for (const { attachment, bytes } of ready) {
      await writeFile(join(MEDIA_DIR, attachment.file), bytes, { flag: 'wx' })
      written.push(attachment)
    }
    return written
  }
  catch (error) {
    await removeBlogAttachments(written)
    throw error
  }
}

export function blogBodyWithAttachments(body: string, slug: string, attachments: readonly BlogAttachment[]): string {
  if (!attachments.length) return body
  const figures = attachments.map(({ file, alt }) => {
    const label = alt.replace(/\s+/g, ' ').replace(/[&\[\]<>\\`*_]/g, char => `&#${char.charCodeAt(0)};`)
    const url = `/api/postline/blog/media?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`
    return `![${label}](${url})`
  })
  return [...figures, body].join('\n\n')
}
