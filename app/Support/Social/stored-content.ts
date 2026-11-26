import type { PostOptions } from './post-options'
import type { VariantMap } from './variants'
import { isSafeMediaFilename } from './uploads'

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
