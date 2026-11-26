import { openLabel } from '../assets/scripts/lib/open-label'
import { escapeHtml } from './postline-client'

export type PostlineToastTone = 'neutral' | 'success' | 'error' | 'info'

export interface PostlineToastOptions {
  title?: string
  message: string
  tone?: PostlineToastTone
  url?: string
  durationMs?: number
  /** Replaces an existing toast with this id (e.g. dismiss "Publishing" on success). */
  id?: string
  /** Suppress an identical recent toast. Set to 0 when repeats are intentional. */
  dedupeMs?: number
  /** A button that does something and closes the toast: Undo, Retry. */
  action?: { label: string, run: () => void }
}

const ICONS: Record<PostlineToastTone, string> = {
  success: 'i-hugeicons-checkmark-circle-02',
  error: 'i-hugeicons-alert-circle',
  info: 'i-hugeicons-information-circle',
  neutral: 'i-hugeicons-notification-02',
}

const recentToasts = new Map<string, number>()
const RECENT_TOASTS_KEY = 'postline.toast.recent'

function toastFingerprint(options: PostlineToastOptions, tone: PostlineToastTone, title: string): string {
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

function formatUrlLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.length > 36
      ? `${parsed.pathname.slice(0, 36)}…`
      : parsed.pathname
    return `${parsed.hostname}${path}`
  }
  catch {
    return url.length > 48 ? `${url.slice(0, 48)}…` : url
  }
}

function linkUrl(url: string | undefined, base: string): string | undefined {
  if (!url) return
  try {
    const { protocol } = new URL(url, base)
    if (protocol === 'https:' || protocol === 'http:') return url
  }
  catch {}
}

function dismissToast(toast: HTMLElement): void {
  if (toast.classList.contains('is-leaving')) return
  toast.classList.remove('is-visible')
  toast.classList.add('is-leaving')
  setTimeout(() => toast.remove(), 220)
}

export function dismissPostlineToast(id: string): void {
  for (const toast of document.querySelectorAll<HTMLElement>('#postline-toast-host [data-toast-id]')) {
    if (toast.dataset.toastId === id) dismissToast(toast)
  }
}

export function showPostlineToast(options: PostlineToastOptions): void {
  const host = document.getElementById('postline-toast-host')
  if (!host) return

  const tone = options.tone ?? 'neutral'
  const title = options.title ?? (tone === 'success' ? 'Published' : tone === 'error' ? 'Error' : tone === 'info' ? 'Working' : 'Postline')
  const dedupeMs = options.dedupeMs ?? (tone === 'success' ? 6000 : 2000)
  if (wasRecentlyShown(toastFingerprint(options, tone, title), dedupeMs)) return

  if (options.id) dismissPostlineToast(options.id)
  const durationMs = options.durationMs ?? (tone === 'error' ? 12000 : tone === 'info' ? 0 : 8000)
  const isLoading = tone === 'info' && /publish/i.test(title)

  const toast = document.createElement('div')
  toast.className = `postline-toast postline-toast--${tone}`
  toast.setAttribute('role', 'status')

  if (options.id) toast.dataset.toastId = options.id
  const icon = isLoading ? 'i-hugeicons-loading-03 postline-toast__spinner' : ICONS[tone]
  const url = linkUrl(options.url, host.ownerDocument.baseURI)

  const bodyMarkup = url
    ? `<p class="postline-toast__message">${escapeHtml(options.message)}</p>
      <a class="postline-toast__url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}">${escapeHtml(formatUrlLabel(url))}</a>`
    : `<p class="postline-toast__message">${escapeHtml(options.message)}</p>`

  toast.innerHTML = `
    <div class="postline-toast__row">
      <div class="postline-toast__icon"><span class="h-5 w-5 ${icon}" aria-hidden="true"></span></div>
      <div class="postline-toast__body">
        <div class="postline-toast__header">
          <strong class="postline-toast__title">${escapeHtml(title)}</strong>
          <button type="button" class="postline-toast__close" aria-label="Dismiss" data-toast-dismiss>
            <span class="h-4 w-4 i-hugeicons-cancel-01" aria-hidden="true"></span>
          </button>
        </div>
        ${bodyMarkup}
      </div>
    </div>
    ${url
      ? `<div class="postline-toast__actions">
          <a class="postline-toast__btn postline-toast__btn--primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(openLabel(url))}</a>
          <button type="button" class="postline-toast__btn postline-toast__btn--secondary" data-toast-copy>Copy link</button>
        </div>`
      : options.action
        ? `<div class="postline-toast__actions">
          <button type="button" class="postline-toast__btn postline-toast__btn--primary" data-toast-action>${escapeHtml(options.action.label)}</button>
        </div>`
        : ''}
  `

  toast.querySelector('[data-toast-action]')?.addEventListener('click', () => {
    dismissToast(toast)
    options.action?.run()
  })

  toast.querySelector('[data-toast-dismiss]')?.addEventListener('click', () => dismissToast(toast))
  toast.querySelector('[data-toast-copy]')?.addEventListener('click', async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      showPostlineToast({ title: 'Copied', message: 'Link copied to clipboard.', tone: 'success', durationMs: 2800 })
    }
    catch {
      showPostlineToast({ title: 'Copy failed', message: 'Could not copy the link.', tone: 'error', durationMs: 5000 })
    }
  })

  host.prepend(toast)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!toast.classList.contains('is-leaving')) toast.classList.add('is-visible')
    })
  })

  if (durationMs > 0) {
    setTimeout(() => dismissToast(toast), durationMs)
  }
}
