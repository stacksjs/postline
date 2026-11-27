import { openLabel } from '../assets/scripts/lib/open-label'

type NotificationTone = 'neutral' | 'success' | 'error' | 'info'

interface NotificationOptions {
  title?: string
  message: string
  tone?: NotificationTone
  url?: string
  durationMs?: number
  id?: string
  dedupeMs?: number
  action?: { label: string, run: () => void, dismiss?: boolean }
  loading?: boolean
}

const recentToasts = new Map<string, number>()
const RECENT_TOASTS_KEY = 'postline.toast.recent'

function toastFingerprint(options: NotificationOptions, tone: NotificationTone, title: string): string {
  return [tone, title, options.message, options.url || ''].join('\u001f')
}

function wasRecentlyShown(fingerprint: string, dedupeMs: number): boolean {
  if (dedupeMs <= 0) return false

  const current = Date.now()
  try {
    const stored: Record<string, number> = JSON.parse(sessionStorage.getItem(RECENT_TOASTS_KEY) || '{}')
    if (current - (stored[fingerprint] || 0) < dedupeMs) return true
    const recent = Object.fromEntries(Object.entries(stored).filter(([, timestamp]) => current - timestamp < 60_000))
    recent[fingerprint] = current
    sessionStorage.setItem(RECENT_TOASTS_KEY, JSON.stringify(recent))
    return false
  }
  catch {
    if (current - (recentToasts.get(fingerprint) || 0) < dedupeMs) return true
    for (const [key, timestamp] of recentToasts) {
      if (current - timestamp >= 60_000) recentToasts.delete(key)
    }
    recentToasts.set(fingerprint, current)
    return false
  }
}

function publishedLink(value?: string): string | undefined {
  if (!value) return
  try {
    const url = new URL(value, location.href)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  }
  catch {}
}

export function showNotification(options: NotificationOptions): void {
  const notifier = window.stx?.toast
  if (!notifier) return
  const tone = options.tone ?? 'neutral'
  const title = options.title ?? (tone === 'success' ? 'Published' : tone === 'error' ? 'Error' : tone === 'info' ? 'Working' : 'Postline')
  const dedupeMs = options.dedupeMs ?? (tone === 'success' ? 6000 : 2000)
  if (wasRecentlyShown(toastFingerprint(options, tone, title), dedupeMs)) return

  const actions: StxToastAction[] = []
  const url = publishedLink(options.url)
  if (url) {
    actions.push({ label: openLabel(url), href: url, target: '_blank' })
    actions.push({
      label: 'Copy link',
      dismiss: false,
      async onClick() {
        try {
          await navigator.clipboard.writeText(url)
          notifier.success('Link copied to clipboard.', { title: 'Copied', duration: 2800 })
        }
        catch {
          notifier.error('Could not copy the link.', { title: 'Copy failed', duration: 5000 })
        }
      },
    })
  }
  else if (options.action) {
    actions.push({ label: options.action.label, onClick: options.action.run, dismiss: options.action.dismiss })
  }

  const duration = options.durationMs ?? (tone === 'error' ? 12000 : tone === 'info' ? 0 : 8000)
  notifier[tone === 'neutral' ? 'info' : tone](options.message, { title, duration, id: options.id, loading: options.loading, actions })
}
