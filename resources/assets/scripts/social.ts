/** One connected account on a network. Several per network are allowed. */
export interface AccountStatus {
  id: number
  provider: string
  handle: string
  displayName: string | null
  authStatus: string
  connected: boolean
  canPublish: boolean
  /** The account a bare network target (`bluesky`) publishes through. */
  isDefault: boolean
  instance?: string | null
  avatar: string | null
}

/**
 * A network's state. The single-account fields describe its default account,
 * as they always have; `accounts` lists every connected one (absent for our
 * own targets, which have no accounts).
 */
export interface ProviderStatus {
  provider: string
  connected: boolean
  canPublish: boolean
  /** The default account's id, when the network has one. */
  id?: number | null
  handle: string | null
  displayName?: string | null
  characterLimit: number
  authStatus: string
  configuredFromEnv?: boolean
  oauthConfigured?: boolean
  accounts?: AccountStatus[]
}

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
  /** The post's language, and Mastodon's visibility and content warning. */
  options?: { language?: string, mastodonVisibility?: string, mastodonSpoiler?: string }
  /** Multi-segment thread; reply-chained on providers that support it. */
  thread?: string[]
  /**
   * Per-provider body overrides, keyed by provider. Providers absent here
   * publish `text`. Ignored for threads, which always use their shared segments.
   */
  variants?: Record<string, string>
}

const PROVIDER_LABELS: Record<string, string> = {
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  mastodon: 'Mastodon',
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  tiktok: 'TikTok',
  blog: 'Blog',
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
}

/**
 * An account's handle as people write it. Mastodon handles are stored as
 * `@user@host` already; LinkedIn's "handle" is a display name, which an @
 * would make look like a username it is not.
 */
export function formatHandle(provider: string, handle: string | null | undefined): string {
  const value = String(handle || '').trim()
  if (!value) return ''
  if (provider === 'linkedin' || value.startsWith('@')) return value
  return `@${value}`
}

/** "Bluesky @alice.bsky.social" — or just "Bluesky" when there is no account. */
export function targetLabel(provider: string, handle?: string | null): string {
  const formatted = formatHandle(provider, handle)
  return formatted ? `${providerLabel(provider)} ${formatted}` : providerLabel(provider)
}

const PROVIDER_ICONS: Record<string, string> = {
  bluesky: 'i-simple-icons-bluesky',
  twitter: 'i-simple-icons-x',
  mastodon: 'i-simple-icons-mastodon',
  linkedin: 'i-simple-icons-linkedin',
  instagram: 'i-simple-icons-instagram',
  threads: 'i-simple-icons-threads',
  blog: 'i-hugeicons-quill-write-02',
}

/** The Iconify class for a network. Pages list these statically for Crosswind. */
export function providerIcon(provider: string): string {
  return PROVIDER_ICONS[provider] || 'i-hugeicons-share-08'
}

/** A network whose connection the Accounts page shows. */
export type StatusNetwork = 'bluesky' | 'linkedin' | 'instagram' | 'threads' | 'twitter' | 'mastodon'

/**
 * One network's connection, as `/api/postline/<network>/status` answers it.
 * The fields every network sends, and the ones only some do.
 */
export interface NetworkStatus {
  connected: boolean
  provider: string
  id: number | null
  handle: string | null
  displayName: string | null
  canPublish: boolean
  characterLimit: number
  configuredFromEnv: boolean
  authStatus: string
  oauthConfigured?: boolean
  requiresMedia?: boolean
  accounts?: AccountStatus[]
  [key: string]: unknown
}

/**
 * Reads that every view makes, kept for a short while (#183). Moving between
 * the composer, the queue, campaigns and Settings asked for the connected
 * accounts again each time; now a read within FRESH_MS reuses the answer, and
 * anything that changes accounts calls `invalidate()`. A failed read is not
 * kept, so the next one tries again.
 */
const FRESH_MS = 30_000
const cache = new Map<string, { at: number, value: Promise<unknown> }>()

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.value as Promise<T>
  const value = load().catch((error) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Forget every cached read, after something that changes accounts or networks. */
export function invalidate(): void {
  cache.clear()
}

// Any write to Postline's API may change what these reads answer (a connect,
// a disconnect, a saved app), so a write clears them all. Done here, once,
// rather than at every place in the views that writes.
if (typeof window !== 'undefined' && !(window as unknown as { __postlineReadCacheBound?: boolean }).__postlineReadCacheBound) {
  ;(window as unknown as { __postlineReadCacheBound?: boolean }).__postlineReadCacheBound = true
  const send = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const url = String(input instanceof Request ? input.url : input)
    if (method !== 'GET' && method !== 'HEAD' && url.includes('/api/')) invalidate()
    return send(input, init)
  }) as typeof fetch
}

/** One client for every network's status, in place of a module per network (#181). */
export async function fetchStatus(network: StatusNetwork): Promise<NetworkStatus> {
  return await cached(`status:${network}`, async () => {
    const response = await fetch(`/api/postline/${network}/status`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.ok)
      throw new Error(payload.error || `Could not load ${providerLabel(network)} status.`)
    return payload.data as NetworkStatus
  })
}

/** The workspace profile (its name and time zone), which most views read. */
export async function fetchWorkspace(): Promise<{ name: string, workspaceName: string, timezone: string } & Record<string, unknown>> {
  return await cached('workspace', async () => {
    const response = await fetch('/api/postline/settings/workspace')
    const payload = await response.json()
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load the workspace.')
    return payload.data
  })
}

/** A link's preview card, asked for once however often the composer redraws it. */
export async function fetchLinkPreview(url: string): Promise<Record<string, unknown>> {
  return await cached(`preview:${url}`, async () => {
    const response = await fetch(`/api/postline/bluesky/link-preview?url=${encodeURIComponent(url)}`)
    const payload = await response.json()
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not render link preview.')
    return payload.data
  })
}

export async function fetchProviders(): Promise<ProviderStatus[]> {
  return await cached('providers', async () => {
    const response = await fetch('/api/postline/providers')
    const payload = await response.json()
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Could not load connected accounts.')
    }
    return (payload.data?.providers || []) as ProviderStatus[]
  })
}

export async function publishCrosspost(input: CrosspostInput): Promise<{ postId: number, results: CrosspostResultItem[] }> {
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
  if (input.variants && Object.keys(input.variants).length)
    body.set('variants', JSON.stringify(input.variants))
  if (input.options?.language) body.set('language', input.options.language)
  if (input.options?.mastodonVisibility) body.set('mastodon_visibility', input.options.mastodonVisibility)
  if (input.options?.mastodonSpoiler) body.set('mastodon_spoiler', input.options.mastodonSpoiler)

  const response = await fetch('/api/postline/publish', { method: 'POST', body })
  const payload = await response.json()
  if (!payload?.data) {
    throw new Error(payload?.error || 'Publish failed.')
  }
  return payload.data as { postId: number, results: CrosspostResultItem[] }
}

declare global {
  interface Window {
    postlineSocial?: {
      invalidate: typeof invalidate
      fetchWorkspace: typeof fetchWorkspace
      fetchLinkPreview: typeof fetchLinkPreview
      fetchStatus: typeof fetchStatus
      fetchProviders: typeof fetchProviders
      publishCrosspost: typeof publishCrosspost
      providerLabel: typeof providerLabel
      providerIcon: typeof providerIcon
      formatHandle: typeof formatHandle
      targetLabel: typeof targetLabel
    }
  }
}

window.postlineSocial = {
  invalidate,
  fetchWorkspace,
  fetchLinkPreview,
  fetchStatus,
  fetchProviders,
  publishCrosspost,
  providerLabel,
  providerIcon,
  formatHandle,
  targetLabel,
}
