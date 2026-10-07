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
  opentimes: 'The Open Times',
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
  opentimes: 'i-hugeicons-news',
}

/** The Iconify class for a network. Pages list these statically for Crosswind. */
export function providerIcon(provider: string): string {
  return PROVIDER_ICONS[provider] || 'i-hugeicons-share-08'
}

export async function fetchProviders(): Promise<ProviderStatus[]> {
  const response = await fetch('/api/ot/providers')
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not load connected accounts.')
  }
  return (payload.data?.providers || []) as ProviderStatus[]
}

/** Every connected account, across networks. */
export async function fetchAccounts(): Promise<AccountStatus[]> {
  const response = await fetch('/api/ot/accounts')
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not load connected accounts.')
  }
  return (payload.data?.accounts || []) as AccountStatus[]
}

/**
 * Disconnect one account. Its tokens are dropped server-side; posts it already
 * published keep their history.
 */
export async function disconnectAccount(id: number): Promise<AccountStatus> {
  const body = new FormData()
  body.set('id', String(id))
  const response = await fetch('/api/ot/accounts/disconnect', { method: 'POST', body })
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not disconnect the account.')
  }
  return payload.data as AccountStatus
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
  if (input.variants && Object.keys(input.variants).length)
    body.set('variants', JSON.stringify(input.variants))

  const response = await fetch('/api/ot/publish', { method: 'POST', body })
  const payload = await response.json()
  if (!payload?.data) {
    throw new Error(payload?.error || 'Publish failed.')
  }
  return payload.data as { postId: number, results: CrosspostResultItem[] }
}

declare global {
  interface Window {
    opentimesSocial?: {
      fetchProviders: typeof fetchProviders
      fetchAccounts: typeof fetchAccounts
      disconnectAccount: typeof disconnectAccount
      publishCrosspost: typeof publishCrosspost
      providerLabel: typeof providerLabel
      providerIcon: typeof providerIcon
      formatHandle: typeof formatHandle
      targetLabel: typeof targetLabel
    }
  }
}

window.opentimesSocial = {
  fetchProviders,
  fetchAccounts,
  disconnectAccount,
  publishCrosspost,
  providerLabel,
  providerIcon,
  formatHandle,
  targetLabel,
}
