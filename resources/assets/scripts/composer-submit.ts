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
  removeImage: boolean
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
  if (queue?.id) {
    body.set('id', String(queue.id))
    if (queue.removeImage && !input.imageFiles?.length && !input.imageFile) body.set('remove_image', '1')
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
