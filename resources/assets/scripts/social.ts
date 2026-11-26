import { providerIcon, providerLabel } from '../../functions/networks'
import { fetchWorkspaceBootstrap, refreshWorkspaceBootstrap } from '../../functions/postline-client'

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
 * Link previews are keyed by URL. They can be reused independently of
 * workspace state. A failed read is retried the next time it is needed.
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

/** A channel card reads from the same workspace query as the composer. */
export async function fetchStatus(network: StatusNetwork): Promise<NetworkStatus> {
  const { providers } = await fetchWorkspaceBootstrap()
  const provider = providers.find(entry => entry.provider === network)
  if (!provider) throw new Error(`Could not load ${providerLabel(network)} status.`)
  return provider as NetworkStatus
}

/** The workspace profile (its name and time zone), which most views read. */
export async function fetchWorkspace() {
  return (await fetchWorkspaceBootstrap()).workspace
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
  return (await fetchWorkspaceBootstrap()).providers
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

// The desktop Settings window and the workspace have separate JS contexts.
const workspaceChanges = typeof BroadcastChannel === 'function' ? new BroadcastChannel('postline:workspace') : null
workspaceChanges?.addEventListener('message', (event) => {
  if (event.data === 'changed') void refreshWorkspaceBootstrap()
})
window.addEventListener('postline:workspace-changed', () => workspaceChanges?.postMessage('changed'))

declare global {
  interface Window {
    postlineSocial?: {
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
