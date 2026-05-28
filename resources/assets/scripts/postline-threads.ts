export interface ThreadsStatusPayload {
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

export async function fetchThreadsStatus(): Promise<ThreadsStatusPayload> {
  const response = await fetch('/api/postline/threads/status')
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not load Threads status.')
  }
  return payload.data as ThreadsStatusPayload
}

export function formatThreadsConnectionLabel(status: ThreadsStatusPayload): string {
  if (status.canPublish && status.handle) return `@${status.handle}`
  if (status.handle) return `@${status.handle} — reconnect`
  if (status.configuredFromEnv) return 'Configured in .env'
  if (status.oauthConfigured) return 'Connect with Threads'
  return 'Not configured'
}

declare global {
  interface Window {
    postlineThreads?: {
      fetchStatus: typeof fetchThreadsStatus
      formatConnectionLabel: typeof formatThreadsConnectionLabel
    }
  }
}

window.postlineThreads = {
  fetchStatus: fetchThreadsStatus,
  formatConnectionLabel: formatThreadsConnectionLabel,
}
