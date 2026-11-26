import type { NetworkAppSummary } from '../../app/Services/NetworkAppService'
import type { WorkspaceProfile } from '../../app/Services/WorkspaceService'
import type { AccountStatus, ProviderStatus } from '../assets/scripts/social'

interface WorkspaceBootstrap {
  workspace: WorkspaceProfile
  providers: ProviderStatus[]
  accounts: AccountStatus[]
  networkApps: NetworkAppSummary[]
  unread: { inbox: number, listening: number }
}

const bootstrapUrl = '/api/postline/bootstrap'
const workspaceWrites = new Set([
  '/api/postline/accounts/default',
  '/api/postline/accounts/disconnect',
  '/api/postline/bluesky/connect',
  '/api/postline/twitter/connect',
  '/api/postline/mastodon/connect',
  '/api/postline/linkedin/connect',
  '/api/postline/instagram/connect',
  '/api/postline/threads/connect',
  '/api/postline/network-apps',
  '/api/postline/network-apps/clear',
  '/api/postline/settings/workspace',
  '/api/postline/settings/import',
  '/api/postline/settings/delete-everything',
  '/api/postline/inbox/read',
  '/api/postline/inbox/archive',
  '/api/postline/inbox/reply',
  '/api/postline/inbox/sync',
  '/api/postline/listening',
  '/api/postline/listening/delete',
  '/api/postline/listening/read',
  '/api/postline/listening/scan',
])

export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function relativeTime(value: string | null | undefined, options: { compact?: boolean, fallback?: string } = {}): string {
  if (!value) return options.fallback ?? ''
  const timestamp = value.replace(' ', 'T')
  // SQLite timestamps without a zone are UTC. Preserve offsets supplied by providers.
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`)
  if (Number.isNaN(date.getTime())) return options.fallback ?? ''

  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  const suffix = options.compact ? '' : ' ago'
  if (minutes < 1) return options.compact ? 'now' : 'just now'
  if (minutes < 60) return `${minutes}m${suffix}`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h${suffix}`
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d${suffix}`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export async function requestJson(url: string, options: RequestInit = {}, errorMessage?: string) {
  const headers = new Headers(options.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(url, { ...options, headers })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.ok === false)
    throw new Error(payload?.error || payload?.message || errorMessage || (response.status === 404 ? 'Not found.' : 'That did not work.'))
  if (options.method && !/^(?:get|head)$/i.test(options.method) && workspaceWrites.has(url)) {
    void refreshWorkspaceBootstrap()
    announceWorkspaceChange()
  }
  return payload
}

export function workspaceBootstrapQuery() {
  return window.stx.cachedQuery<WorkspaceBootstrap | null>('postline:workspace-bootstrap', {
    url: bootstrapUrl,
    scope: false, // Keep the authenticated snapshot in this document's memory.
    staleTime: 60_000,
    load: async ({ signal }) => {
      const payload = await requestJson(bootstrapUrl, { cache: 'no-store', signal }, 'Could not load the workspace.')
      return payload.data
    },
  })
}

export async function fetchWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  const query = workspaceBootstrapQuery()
  const data = await query.load()
  if (!data) throw new Error(query.error() || 'Could not load the workspace.')
  return data
}

export async function refreshWorkspaceBootstrap(): Promise<void> {
  const query = workspaceBootstrapQuery()
  query.invalidate()
  await query.refresh()
}

export function announceWorkspaceChange(): void {
  window.dispatchEvent(new Event('postline:workspace-changed'))
}

export async function disconnectSocialAccount(id: number): Promise<void> {
  const body = new FormData()
  body.set('id', String(id))
  await requestJson('/api/postline/accounts/disconnect', { method: 'POST', body }, 'Could not disconnect the account.')
}
