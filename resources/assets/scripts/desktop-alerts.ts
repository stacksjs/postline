/**
 * Alerts as Mac notifications and a dock badge (#112, #200), and the
 * menu-bar item (#195).
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
interface CraftTray {
  setIcon?: (icon: string) => Promise<void>
  setTitle?: (title: string) => Promise<void>
  setTooltip?: (tooltip: string) => Promise<void>
  setMenu?: (items: Array<{ label?: string, action?: string, type?: 'separator' | 'normal' | 'checkbox', enabled?: boolean, checked?: boolean }>) => Promise<void>
}

const SEEN_KEY = 'postline:alerts:last-seen'
const POLL_MS = 60_000

function craftApp(): CraftApp | undefined {
  return (window as unknown as { craft?: { app?: CraftApp } }).craft?.app
}

function craftTray(): CraftTray | undefined {
  return (window as unknown as { craft?: { tray?: CraftTray } }).craft?.tray
}

interface CraftAutoLaunch {
  enable?: () => Promise<boolean>
  disable?: () => Promise<boolean>
  isEnabled?: () => Promise<boolean>
}

function craftAutoLaunch(): CraftAutoLaunch | undefined {
  return (window as unknown as { craft?: { autoLaunch?: CraftAutoLaunch } }).craft?.autoLaunch
}

interface DesktopStatus { paused: boolean, nextPostAt: string | null, unread: number }
let status: DesktopStatus = { paused: false, nextPostAt: null, unread: 0 }
let openAtLogin = false

function whenText(iso: string): string {
  const at = new Date(iso)
  const sameDay = at.toDateString() === new Date().toDateString()
  return at.toLocaleString(undefined, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/**
 * The menu-bar item (#195). The app keeps running when its window closes, so
 * the scheduler still publishes; this says what goes out next, pauses and
 * resumes scheduled publishing, opens the app at login, and is the way back
 * to the window and the way to quit. `show` and `quit` are actions Craft
 * carries out itself; the others come back as `craft:tray:menuAction`.
 */
async function setUpTray(): Promise<void> {
  const tray = craftTray()
  if (!tray) return
  const { paused, nextPostAt, unread } = status
  await tray.setIcon?.(paused ? 'pause.circle' : 'paperplane').catch(() => {})
  // The icon alone, as menu-bar items go; Craft titles it with the app name.
  await tray.setTitle?.('').catch(() => {})
  await tray.setTooltip?.(paused ? 'Postline: publishing paused' : unread ? `Postline: ${unread} need${unread === 1 ? 's' : ''} attention` : 'Postline').catch(() => {})
  await tray.setMenu?.([
    { label: 'Open Postline', action: 'show' },
    { type: 'separator' },
    { label: paused ? 'Publishing is paused' : nextPostAt ? `Next post: ${whenText(nextPostAt)}` : 'Nothing scheduled', enabled: false },
    ...(unread ? [{ label: `${unread} alert${unread === 1 ? '' : 's'} need${unread === 1 ? 's' : ''} attention`, enabled: false }] : []),
    { label: paused ? 'Resume Publishing' : 'Pause Publishing', action: 'toggle-publishing' },
    ...(craftAutoLaunch() ? [{ label: 'Open at Login', action: 'toggle-login', type: 'checkbox' as const, checked: openAtLogin }] : []),
    { type: 'separator' },
    { label: 'Quit Postline', action: 'quit' },
  ]).catch(() => {})
}

async function refreshStatus(): Promise<void> {
  try {
    const response = await fetch('/api/postline/desktop/status', { headers: { Accept: 'application/json' } })
    const payload = await response.json()
    if (response.ok && payload.ok) status = payload.data as DesktopStatus
  }
  catch {}
  openAtLogin = await craftAutoLaunch()?.isEnabled?.().catch(() => false) ?? false
  await setUpTray()
}

async function onTrayAction(action: string): Promise<void> {
  if (action === 'toggle-publishing') {
    const body = new FormData()
    body.set('publishingPaused', status.paused ? '0' : '1')
    await fetch('/api/postline/settings/workspace', { method: 'POST', body }).catch(() => {})
  }
  else if (action === 'toggle-login') {
    const launch = craftAutoLaunch()
    await (openAtLogin ? launch?.disable?.() : launch?.enable?.())?.catch(() => {})
  }
  await refreshStatus()
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
  const unread = Math.max(0, Number(payload.data?.unread) || 0)
  await app.setBadge?.(unread).catch(() => {})
  await refreshStatus()
}

declare global {
  interface Window {
    __postlineAlertsPolling?: boolean
  }
}

// Once per window, however many pages the router swaps in.
if (craftApp() && !window.__postlineAlertsPolling) {
  window.__postlineAlertsPolling = true
  window.addEventListener('craft:tray:menuAction', (event) => {
    const action = String((event as CustomEvent<{ action?: string }>).detail?.action || '')
    if (action) void onTrayAction(action)
  })
  void check()
  setInterval(() => void check(), POLL_MS)
}

export { check }
