export interface LinkedInStatusPayload {
  connected: boolean
  provider: string
  handle: string | null
  displayName: string | null
  canPublish: boolean
  characterLimit: number
  configuredFromEnv: boolean
  oauthConfigured: boolean
  authStatus: string
}

export async function fetchLinkedInStatus(): Promise<LinkedInStatusPayload> {
  const response = await fetch('/api/postline/linkedin/status')
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not load LinkedIn status.')
  }
  return payload.data as LinkedInStatusPayload
}

export function formatLinkedInConnectionLabel(status: LinkedInStatusPayload): string {
  if (status.canPublish && status.displayName) return status.displayName
  if (status.canPublish && status.handle) return status.handle
  if (status.handle) return `${status.handle} — reconnect`
  if (status.configuredFromEnv) return 'Configured in .env'
  if (status.oauthConfigured) return 'Connect with LinkedIn'
  return 'Not configured'
}

declare global {
  interface Window {
    postlineLinkedin?: {
      fetchStatus: typeof fetchLinkedInStatus
      formatConnectionLabel: typeof formatLinkedInConnectionLabel
    }
  }
}

window.postlineLinkedin = {
  fetchStatus: fetchLinkedInStatus,
  formatConnectionLabel: formatLinkedInConnectionLabel,
}
