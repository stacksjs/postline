import type { StoredContent } from './stored-content'
import type { PublishContent } from './types'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { isSafeMediaFilename, MEDIA_DIR } from './uploads'

/**
 * Write each uploaded attachment to the media folder and describe all of them for
 * the stored content. An image given by address is kept as its address.
 */
export async function storeAttachments(postUuid: string, attachments: readonly NonNullable<PublishContent['media']>[number][]): Promise<NonNullable<StoredContent['media']>> {
  const media: NonNullable<StoredContent['media']> = []
  try {
    for (const attachment of attachments) {
      if (attachment.bytes?.length) {
        const extension = (attachment.mimeType || 'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg'
        const filename = `${postUuid}-${crypto.randomUUID().slice(0, 8)}.${extension}`
        media.push({ path: filename, mimeType: attachment.mimeType, altText: attachment.altText })
        await mkdir(MEDIA_DIR, { recursive: true })
        await Bun.write(join(MEDIA_DIR, filename), attachment.bytes)
      }
      else if (attachment.url) {
        media.push({ url: attachment.url, altText: attachment.altText })
      }
    }
  }
  catch (error) {
    await removeMediaFiles(media)
    throw error
  }
  return media
}

export async function removeMediaFiles(media: StoredContent['media'], failOnError = false): Promise<void> {
  for (const item of media || []) {
    if (!item.path || !isSafeMediaFilename(item.path)) continue
    await unlink(join(MEDIA_DIR, item.path)).catch((error: NodeJS.ErrnoException) => {
      if (failOnError && error.code !== 'ENOENT') throw error
    })
  }
}
