import type { PostOptions } from './post-options'
import type { PublishContent } from './types'
import type { VariantMap } from './variants'
import { join } from 'node:path'
import { UserFacingError } from '../Http/user-error'
import { sanitizePostOptions } from './post-options'
import { isSafeMediaFilename, MEDIA_DIR, publicMediaUrl } from './uploads'
import { sanitizeVariants } from './variants'

/** The non-text content persisted with a post. */
export interface StoredContent {
  title?: string
  external?: { uri: string, title: string, description?: string }
  media?: Array<{ url?: string, path?: string, mimeType?: string, altText?: string }>
  variants?: VariantMap
  options?: PostOptions
}

export function parseStoredContent(raw: unknown): StoredContent | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(String(raw))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const stored = parsed as StoredContent
    stored.media = Array.isArray(stored.media) ? stored.media.filter(item => item && typeof item === 'object') : undefined
    return stored
  }
  catch {
    return null
  }
}

export function referencedMediaFiles(raw: unknown): string[] {
  const paths: string[] = []
  for (const item of parseStoredContent(raw)?.media ?? []) {
    if (!item.path) continue
    if (!isSafeMediaFilename(item.path)) throw new Error('A post contains an invalid stored image reference.')
    paths.push(item.path)
  }
  return paths
}

/** A missing attachment must never turn an image post into a text post. */
export class MissingMediaError extends UserFacingError {
  constructor() {
    super('The image attached to this post is missing, so it was not sent. Attach it again, or remove it from the post.')
  }
}

export async function hydrateStoredContent(raw: unknown): Promise<PublishContent | undefined> {
  const stored = parseStoredContent(raw)
  if (!stored) return undefined

  const content: PublishContent = {}
  if (stored.title) content.title = stored.title
  if (stored.external) content.external = stored.external
  const variants = sanitizeVariants(stored.variants)
  if (variants) content.variants = variants
  const options = sanitizePostOptions(stored.options)
  if (options) content.options = options

  const media: NonNullable<PublishContent['media']> = []
  for (const item of stored.media || []) {
    if (item.path) {
      if (!isSafeMediaFilename(item.path)) throw new MissingMediaError()
      const file = Bun.file(join(MEDIA_DIR, item.path))
      if (!(await file.exists())) throw new MissingMediaError()
      media.push({
        bytes: new Uint8Array(await file.arrayBuffer()),
        // Some networks can upload bytes. Others fetch the same file by URL
        // when this workspace has a public media address.
        url: publicMediaUrl(item.path) ?? undefined,
        mimeType: item.mimeType,
        altText: item.altText,
      })
    }
    else if (item.url) {
      media.push({ url: item.url, altText: item.altText })
    }
  }
  if (media.length) content.media = media
  return Object.keys(content).length ? content : undefined
}
