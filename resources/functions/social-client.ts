import { providerLabel } from './networks'
import { fetchWorkspaceBootstrap } from './postline-client'

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
  expiresAt: string | null
  expiresSoon: boolean
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
  instance?: string | null
  characterLimit: number
  authStatus: string
  configuredFromEnv?: boolean
  oauthConfigured?: boolean
  firstCommentsEnabled?: boolean
  accounts?: AccountStatus[]
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

/** The workspace profile (its name and time zone), which most views read. */
export async function fetchWorkspace() {
  return (await fetchWorkspaceBootstrap()).workspace
}

export async function fetchProviders(): Promise<ProviderStatus[]> {
  return (await fetchWorkspaceBootstrap()).providers
}
