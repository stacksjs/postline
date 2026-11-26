/**
 * Alerts as Mac notifications and a dock badge (#112, #200).
 *
 * Only in the Mac app, where `window.craft` is the native bridge; a browser
 * tab has the Activity page and the alert email instead. The shell polls the
 * alert list once a minute. A notification is raised for each alert newer
 * than the last one this Mac has seen, and the badge shows how many are
 * unread. The first run only records where the list stands, so opening the
 * app for the first time does not replay every old alert.
 */

interface AlertView { id: number, title: string, body: string | null, read: boolean }
interface CraftApp {
  notify?: (options: { title: string, body?: string }) => Promise<void>
  setBadge?: (count: number) => Promise<void>
}

const SEEN_KEY = 'postline:alerts:last-seen'
const POLL_MS = 60_000

function craftApp(): CraftApp | undefined {
  return (window as unknown as { craft?: { app?: CraftApp } }).craft?.app
}

function lastSeen(): number | null {
  try {
    const value = localStorage.getItem(SEEN_KEY)
    return value === null ? null : Number(value) || 0
  }
  catch {
    return null
  }
}

function remember(id: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(id))
  }
  catch {}
}

async function check(): Promise<void> {
  const app = craftApp()
  if (!app) return
  let payload: { ok?: boolean, data?: { alerts?: AlertView[], unread?: number } }
  try {
    const response = await fetch('/api/postline/alerts', { headers: { Accept: 'application/json' } })
    if (!response.ok) return
    payload = await response.json()
  }
  catch {
    return
  }
  const list = payload.data?.alerts ?? []
  const newest = list.reduce((max, alert) => Math.max(max, alert.id), 0)
  const seen = lastSeen()

  if (seen !== null) {
    // Oldest first, so they stack in the order they happened.
    for (const alert of list.filter(alert => alert.id > seen && !alert.read).reverse())
      await app.notify?.({ title: alert.title, ...(alert.body ? { body: alert.body } : {}) }).catch(() => {})
  }
  if (newest > (seen ?? -1)) remember(newest)
  await app.setBadge?.(Math.max(0, Number(payload.data?.unread) || 0)).catch(() => {})
}

declare global {
  interface Window {
    __postlineAlertsPolling?: boolean
  }
}

// Once per window, however many pages the router swaps in.
if (craftApp() && !window.__postlineAlertsPolling) {
  window.__postlineAlertsPolling = true
  void check()
  setInterval(() => void check(), POLL_MS)
}

export { check }
