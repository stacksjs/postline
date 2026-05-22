export interface BlueskyStatusPayload {
  connected: boolean
  provider: string
  handle: string | null
  displayName: string | null
  canPublish: boolean
  characterLimit: number
  configuredFromEnv: boolean
  authStatus: string
}

export async function fetchBlueskyStatus(): Promise<BlueskyStatusPayload> {
  const response = await fetch('/api/postline/bluesky/status')
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not load Bluesky status.')
  }
  return payload.data as BlueskyStatusPayload
}

export function formatBlueskyConnectionLabel(status: BlueskyStatusPayload): string {
  if (status.canPublish && status.handle) return `@${status.handle}`
  if (status.handle) return `@${status.handle} — needs app password`
  if (status.configuredFromEnv) return 'Configured in .env'
  return 'Not connected'
}

declare global {
  interface Window {
    postlineBluesky?: {
      fetchStatus: typeof fetchBlueskyStatus
      formatConnectionLabel: typeof formatBlueskyConnectionLabel
    }
  }
}

window.postlineBluesky = {
  fetchStatus: fetchBlueskyStatus,
  formatConnectionLabel: formatBlueskyConnectionLabel,
}
