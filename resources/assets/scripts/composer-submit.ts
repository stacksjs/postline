import type { QueueEditView } from '../../../app/Services/Social/QueueService'
import type { ComposerImage } from '../../functions/composer-media'
import type { ComposerPreviewImage } from '../../functions/composer-preview'
import type { ComposerVariants } from '../../functions/composer-variants'
import { previewImageUrl } from '../../functions/composer-preview'
import type { POST_OPTION_FIELDS } from '../../../app/Support/Social/post-options'

export interface CrosspostResultItem {
  provider: string
  ok: boolean
  url?: string
  uri?: string
  error?: string
  targetId?: number
  /** Which account it went out through, for telling two on one network apart. */
  identityId?: number
  handle?: string
  target?: string
  firstComment?: { status: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain', error?: string }
}

export type PostOptionFields = Partial<Record<typeof POST_OPTION_FIELDS[number], string>>

function appendPostOptions(form: FormData, options?: PostOptionFields): void {
  for (const [key, value] of Object.entries(options ?? {})) form.set(key, value)
}

export interface CrosspostInput {
  text: string
  /**
   * Targets: network names (`bluesky`, its default account) and/or account
   * specs (`bluesky:12`). Two accounts on one network are two targets.
   */
  providers: string[]
  /** Explicit title for long-form targets (blog). */
  title?: string
  external?: { uri: string, title: string, description?: string }
  image?: { url: string, altText?: string }
  /** Attached image file — uploaded to providers that accept bytes (Bluesky). */
  imageFile?: File
  /** Several attached images, in order, each with its alt text. */
  imageFiles?: Array<{ file: File, alt?: string }>
  video?: { file: File, alt?: string }
  options?: PostOptionFields
  /** Multi-segment thread; reply-chained on providers that support it. */
  thread?: string[]
  /**
   * Per-provider body overrides, keyed by provider. Providers absent here
   * publish `text`. Ignored for threads, which always use their shared segments.
   */
  variants?: Record<string, string>
}

interface QueueDestination {
  id: number | null
  scheduledAt?: string
  nextSlot: boolean
  removeMedia: boolean
}

export function postForm(input: CrosspostInput, queue?: QueueDestination): FormData {
  const body = new FormData()
  body.set('text', input.text)
  body.set('providers', input.providers.join(','))
  if (input.title) body.set('title', input.title)
  if (input.thread && input.thread.length > 1)
    body.set('thread', JSON.stringify(input.thread))
  if (input.external?.uri && input.external?.title) {
    body.set('external_uri', input.external.uri)
    body.set('external_title', input.external.title)
    body.set('external_description', input.external.description || '')
  }
  if (input.image?.url) {
    body.set('image_url', input.image.url)
    if (input.image.altText) body.set('image_alt', input.image.altText)
  }
  if (input.imageFile)
    body.set('image', input.imageFile, input.imageFile.name)
  if (input.imageFiles?.length) {
    for (const entry of input.imageFiles) body.append('images', entry.file, entry.file.name)
    body.set('image_alts', JSON.stringify(input.imageFiles.map(entry => entry.alt || '')))
  }
  if (input.video) {
    body.set('video', input.video.file, input.video.file.name)
    if (input.video.alt) body.set('video_alt', input.video.alt)
  }
  if (queue?.id) {
    body.set('id', String(queue.id))
    if (queue.removeMedia && !input.imageFiles?.length && !input.imageFile && !input.image?.url && !input.video) body.set('remove_media', '1')
  }
  if (queue?.nextSlot) body.set('next_slot', '1')
  else if (queue?.scheduledAt) body.set('scheduled_at', queue.scheduledAt)
  // A queued edit must be able to clear all previously saved overrides.
  const variants = input.variants ?? {}
  if (queue?.id || Object.keys(variants).length) body.set('variants', JSON.stringify(variants))
  appendPostOptions(body, input.options)

  return body
}

export async function publishCrosspost(input: CrosspostInput): Promise<{ postId?: number, postIds?: number[], results: CrosspostResultItem[] }> {
  const response = await fetch('/api/postline/publish', { method: 'POST', body: postForm(input) })
  const payload = await response.json()
  if (!payload?.data) {
    throw new Error(payload?.error || 'Publish failed.')
  }
  return payload.data as { postId: number, results: CrosspostResultItem[] }
}


export async function saveQueuedPost(input: CrosspostInput, destination: QueueDestination): Promise<{ postId?: number, postIds?: number[], status: 'draft' | 'scheduled' }> {
  const endpoint = destination.id ? '/api/postline/queue/update' : '/api/postline/queue'
  const response = await fetch(endpoint, { method: 'POST', body: postForm(input, destination) })
  const payload = await response.json()
  if (!response.ok || !payload.ok)
    throw new Error(payload.error || (destination.id ? 'Could not update the post.' : 'Could not save to the queue.'))
  return payload.data
}

export function summarizePublish(
  results: readonly CrosspostResultItem[],
  count: number,
  providerNames: string,
  label: (provider: string, handle?: string) => string,
) {
  const succeeded = results.filter(result => result.ok)
  const lastUrl = succeeded.findLast(result => result.url)?.url
  const failures = results.filter(result => !result.ok)
    .map(result => `${label(result.provider, result.handle)}: ${result.error || 'failed'}`)
  const failureText = failures.join('; ')
  const notice = failures.length
    ? succeeded.length
      ? { text: `Published to some channels. ${failureText}`, tone: 'info' as const, title: 'Partially published' }
      : { text: `Publish failed. ${failureText}`, tone: 'error' as const, title: 'Publish failed' }
    : {
        text: count > 1 ? `Published ${count} posts to ${providerNames}.` : `Your post is live on ${providerNames}.`,
        tone: 'success' as const,
        title: 'Published',
      }
  return {
    notice,
    lastUrl,
    anySucceeded: succeeded.length > 0,
    firstCommentNeedsAttention: succeeded.some(result => result.firstComment?.status === 'failed' || result.firstComment?.status === 'uncertain'),
  }
}


/** Seed the saved body so a variant only becomes stale after a new edit. */
export function readQueuedVariants(item: Pick<QueueEditView, 'variants' | 'text'>): ComposerVariants {
  return Object.fromEntries(Object.entries(item.variants || {}).flatMap(([provider, text]) =>
    typeof text === 'string' && text.trim() ? [[provider, { text, shared: item.text || '' }]] : []))
}

export function readQueuedAttachments(item: Pick<QueueEditView, 'image' | 'images' | 'video'>): {
  images: ComposerImage[]
  previews: ComposerPreviewImage[]
} {
  const saved = item.images?.length || (item.image ? 1 : 0)
  return {
    images: item.video
      ? [{ id: 'saved-video', file: null, name: 'Saved video', alt: item.video.altText || '', preview: item.video.previewUrl, video: true, kept: true }]
      : saved ? [{ id: 'saved', file: null, name: saved === 1 ? '1 saved image' : `${saved} saved images`, alt: '', kept: true }] : [],
    previews: (item.images || []).flatMap((image, index) => {
      const src = image.previewUrl || previewImageUrl(image.url || '')
      return src ? [{ id: `saved-${index}`, src, alt: image.altText || '' }] : []
    }),
  }
}
