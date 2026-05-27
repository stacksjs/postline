export interface InstagramStatusPayload {
  connected: boolean
  provider: string
  handle: string | null
  displayName: string | null
  canPublish: boolean
  characterLimit: number
  requiresMedia: boolean
  configuredFromEnv: boolean
  oauthConfigured: boolean
  authStatus: string
}

export async function fetchInstagramStatus(): Promise<InstagramStatusPayload> {
  const response = await fetch('/api/postline/instagram/status')
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not load Instagram status.')
  }
  return payload.data as InstagramStatusPayload
}

export function formatInstagramConnectionLabel(status: InstagramStatusPayload): string {
  if (status.canPublish && status.handle) return `@${status.handle}`
  if (status.handle) return `@${status.handle} — reconnect`
  if (status.configuredFromEnv) return 'Configured in .env'
  if (status.oauthConfigured) return 'Connect with Instagram'
  return 'Not configured'
}

declare global {
  interface Window {
    postlineInstagram?: {
      fetchStatus: typeof fetchInstagramStatus
      formatConnectionLabel: typeof formatInstagramConnectionLabel
    }
  }
}

window.postlineInstagram = {
  fetchStatus: fetchInstagramStatus,
  formatConnectionLabel: formatInstagramConnectionLabel,
}
