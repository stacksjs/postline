import { createI18n } from '@stacksjs/i18n/client'
import en from '../../../locales/desktop-alerts/en.json'
import es from '../../../locales/desktop-alerts/es.json'
import { requestJson } from '../../functions/postline-client'
import { xBrowserWindow } from '../../functions/x-browser-session'
import { checkXComposer } from './x-composer-health'
import { scanXListening } from './x-browser-listening'
import { bindXBrowserWrites } from './x-browser-write'

interface AlertView {
  id: number
  title: string
  body: string | null
  read: boolean
}

interface TrayItem {
  label?: string
  action?: string
  type?: 'separator' | 'checkbox'
  enabled?: boolean
  checked?: boolean
}

export interface DesktopAlertsBridge {
  app?: {
    setBadge?: (count: number) => Promise<void>
  }
  notifications?: {
    show?: (options: { id: string, title: string, body?: string }) => Promise<unknown>
    getPermissionStatus?: () => Promise<string>
    requestPermission?: () => Promise<boolean>
  }
  timers?: {
    sleep?: (delayMs: number, options: { signal: AbortSignal }) => Promise<void>
  }
  tray?: {
    setIcon?: (icon: string) => Promise<void>
    setTitle?: (title: string) => Promise<void>
    setTooltip?: (tooltip: string) => Promise<void>
    setMenu?: (items: TrayItem[]) => Promise<void>
  }
  autoLaunch?: {
    enable?: () => Promise<boolean>
    disable?: () => Promise<boolean>
    isEnabled?: () => Promise<boolean>
  }
}

interface DesktopStatus {
  paused: boolean
  nextPostAt: string | null
  unread: number
}

const SEEN_KEY = 'postline:alerts:last-seen'
const POLL_MS = 60_000

function whenText(iso: string, locale: string): string {
  const at = new Date(iso)
  const sameDay = at.toDateString() === new Date().toDateString()
  return at.toLocaleString(locale === 'en' ? undefined : locale, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
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

/** Bind notification delivery, the dock badge and menu-bar controls to a Craft workspace. */
export function bindDesktopAlerts(host: DesktopAlertsBridge, locale: string): () => void {
  const { app, notifications, timers, tray, autoLaunch } = host
  if (!app) return () => {}

  const words = createI18n({ locale, fallbackLocale: 'en', messages: { en, es: es satisfies typeof en } })
  const controller = new AbortController()
  const { signal } = controller
  const xBrowser = xBrowserWindow(host)
  const sleep = timers?.sleep?.bind(timers)
  let checkingX = false
  let seen = lastSeen()
  let status: DesktopStatus = { paused: false, nextPostAt: null, unread: 0 }
  let openAtLogin = false
  let changingMenu = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function markSeen(id: number): void {
    seen = id
    remember(id)
  }

  async function notifyNewAlerts(alerts: AlertView[]): Promise<boolean> {
    if (!alerts.length || !notifications?.show || !notifications.getPermissionStatus) return true
    try {
      const permission = await notifications.getPermissionStatus()
      if (permission === 'unknown') return false
      if (permission !== 'authorized' && permission !== 'provisional') return true
      for (const alert of alerts) {
        if (signal.aborted) return false
        await notifications.show({
          id: `postline-alert-${alert.id}`,
          title: alert.title,
          ...(alert.body ? { body: alert.body } : {}),
        })
        markSeen(alert.id)
      }
      return true
    }
    catch {
      return false
    }
  }

  async function refreshTray(): Promise<void> {
    if (!tray || signal.aborted) return
    const payload = await requestJson('/api/postline/desktop/status', { signal }).catch(() => null)
    if (signal.aborted) return
    if (payload) status = payload.data as DesktopStatus
    openAtLogin = await autoLaunch?.isEnabled?.().catch(() => false) ?? false
    if (signal.aborted) return

    const { paused, nextPostAt, unread } = status
    await tray.setIcon?.(paused ? 'pause.circle' : 'paperplane').catch(() => {})
    await tray.setTitle?.('').catch(() => {})
    await tray.setTooltip?.(paused ? words.t('pausedTooltip') : unread ? words.tc('unreadTooltip', unread) : 'Postline').catch(() => {})
    await tray.setMenu?.([
      { label: words.t('open'), action: 'show' },
      { type: 'separator' },
      { label: paused ? words.t('paused') : nextPostAt ? words.t('upcoming', { time: whenText(nextPostAt, locale) }) : words.t('empty'), enabled: false },
      ...(unread ? [{ label: words.tc('unread', unread), enabled: false }] : []),
      { label: words.t(paused ? 'resume' : 'pause'), action: 'toggle-publishing' },
      ...(autoLaunch ? [{ label: words.t('login'), action: 'toggle-login', type: 'checkbox' as const, checked: openAtLogin }] : []),
      { type: 'separator' },
      { label: words.t('quit'), action: 'quit' },
    ]).catch(() => {})
  }

  async function onTrayAction(event: Event): Promise<void> {
    const action = (event as CustomEvent<{ action?: string }>).detail?.action
    if (changingMenu || (action !== 'toggle-publishing' && action !== 'toggle-login')) return
    changingMenu = true
    try {
      if (action === 'toggle-publishing') {
        const body = new FormData()
        body.set('publishingPaused', status.paused ? '0' : '1')
        await requestJson('/api/postline/settings/workspace', { method: 'POST', body, signal }).catch(() => {})
      }
      else {
        await (openAtLogin ? autoLaunch?.disable?.() : autoLaunch?.enable?.())?.catch(() => {})
      }
      await refreshTray()
    }
    finally {
      changingMenu = false
    }
  }

  async function poll(): Promise<void> {
    const payload = await requestJson('/api/postline/alerts', { signal }).catch(() => null)
    if (signal.aborted) return
    if (payload) {
      const alerts: AlertView[] = payload.data?.alerts ?? []
      const newest = alerts.reduce((max, alert) => Math.max(max, alert.id), 0)
      const previous = seen
      // Record a baseline on the first poll. Announce subsequent unread alerts oldest first.
      if (previous === null) markSeen(newest)
      else if (newest > previous) {
        const pending = alerts.filter(alert => alert.id > previous && !alert.read).reverse()
        if (await notifyNewAlerts(pending) && !signal.aborted) markSeen(newest)
      }
      if (signal.aborted) return
      await app?.setBadge?.(Math.max(0, Number(payload.data?.unread) || 0)).catch(() => {})
    }
    if (!changingMenu) await refreshTray()
    if (signal.aborted) return
    if (xBrowser && sleep && !checkingX) {
      checkingX = true
      void checkXComposer(xBrowser, sleep, signal).then((recorded) => {
        if (recorded && !signal.aborted) window.dispatchEvent(new Event('postline:x-composer-health'))
      }).catch(() => {}).then(() => scanXListening(xBrowser, sleep, signal))
        .then((recorded) => {
          if (recorded && !signal.aborted) window.dispatchEvent(new Event('postline:x-listening'))
        }).catch(() => {}).finally(() => { checkingX = false })
    }
    // WebKit throttles browser timers when the window is closed to the tray.
    // Craft's native deadline also runs while the workspace is hidden.
    if (timers?.sleep) {
      void timers.sleep(POLL_MS, { signal }).then(poll, () => {
        if (!signal.aborted) timer = setTimeout(() => void poll(), POLL_MS)
      })
    }
    else timer = setTimeout(() => void poll(), POLL_MS)
  }

  window.addEventListener('craft:tray:menuAction', (event) => void onTrayAction(event), { signal })
  if (xBrowser && sleep) bindXBrowserWrites(xBrowser, sleep, signal)
  void poll()
  return () => {
    controller.abort()
    clearTimeout(timer)
  }
}
