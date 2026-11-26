import type { AccountStatus } from '../assets/scripts/social'

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
  return payload
}

export async function fetchAccounts(): Promise<AccountStatus[]> {
  const payload = await requestJson('/api/postline/accounts', {}, 'Could not load connected accounts.')
  return Array.isArray(payload.data?.accounts) ? payload.data.accounts : []
}

export async function disconnectSocialAccount(id: number): Promise<void> {
  const body = new FormData()
  body.set('id', String(id))
  await requestJson('/api/postline/accounts/disconnect', { method: 'POST', body }, 'Could not disconnect the account.')
}
