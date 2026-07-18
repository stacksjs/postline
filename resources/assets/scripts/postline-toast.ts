export type PostlineToastTone = 'neutral' | 'success' | 'error' | 'info'

export interface PostlineToastOptions {
  title?: string
  message: string
  tone?: PostlineToastTone
  url?: string
  durationMs?: number
  /** Replaces an existing toast with this id (e.g. dismiss "Publishing" on success). */
  id?: string
}

const ICONS: Record<PostlineToastTone, string> = {
  success: `<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd"/></svg>`,
  error: `<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-3a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 7Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>`,
  info: `<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 9 9Z" clip-rule="evenodd"/></svg>`,
  neutral: `<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M10 2a6 6 0 0 0-6 6v3.586l-.707.707A1 1 0 0 0 4 14h12a1 1 0 0 0 .707-1.707L16 11.586V8a6 6 0 0 0-6-6Zm0 16a2 2 0 0 0 1.995-1.85L12 16h-4l.005.15A2 2 0 0 0 10 18Z"/></svg>`,
}

const SPINNER = `<svg class="postline-toast__spinner" viewBox="0 0 20 20" fill="none" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/><path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`

const toastRegistry = new Map<string, HTMLElement>()
let stylesheetLinked = false

function ensureStyles(): void {
  if (stylesheetLinked) return
  stylesheetLinked = true
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = '/assets/styles/postline-toast.css'
  document.head.append(link)
}

function host(): HTMLElement {
  let element = document.getElementById('postline-toast-host')
  if (!element) {
    element = document.createElement('div')
    element.id = 'postline-toast-host'
    element.className = 'flex bottom-6 fixed right-6 z-[100] sm:right-6 flex-col-reverse gap-2.5 max-w-[22rem] w-[calc(100%-2rem)] pointer-events-none'
    element.setAttribute('aria-live', 'polite')
    element.setAttribute('aria-relevant', 'additions')
    document.body.append(element)
  }
  return element
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

function dismissToast(toast: HTMLElement, id?: string): void {
  if (id) toastRegistry.delete(id)
  toast.classList.remove('is-visible')
  toast.classList.add('is-leaving')
  window.setTimeout(() => toast.remove(), 220)
}

function dismissToastById(id: string): void {
  const existing = toastRegistry.get(id)
  if (existing) dismissToast(existing, id)
}

export function showPostlineToast(options: PostlineToastOptions): void {
  ensureStyles()

  if (options.id) dismissToastById(options.id)

  const tone = options.tone ?? 'neutral'
  const title = options.title ?? (tone === 'success' ? 'Published' : tone === 'error' ? 'Error' : tone === 'info' ? 'Working' : 'Postline')
  const durationMs = options.durationMs ?? (tone === 'error' ? 12000 : tone === 'info' ? 0 : 8000)
  const isLoading = tone === 'info' && /publish/i.test(title)

  const toast = document.createElement('div')
  toast.className = `postline-toast postline-toast--${tone}`
  toast.setAttribute('role', 'status')

  const iconMarkup = isLoading ? SPINNER : ICONS[tone]

  const bodyMarkup = options.url
    ? `<p class="postline-toast__message">${escapeHtml(options.message)}</p>
      <a class="postline-toast__url" href="${escapeHtml(options.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(options.url)}">${escapeHtml(formatUrlLabel(options.url))}</a>`
    : `<p class="postline-toast__message">${escapeHtml(options.message)}</p>`

  toast.innerHTML = `
    <div class="postline-toast__row">
      <div class="postline-toast__icon">${iconMarkup}</div>
      <div class="postline-toast__body">
        <div class="postline-toast__header">
          <strong class="postline-toast__title">${escapeHtml(title)}</strong>
          <button type="button" class="postline-toast__close" aria-label="Dismiss" data-toast-dismiss>
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/></svg>
          </button>
        </div>
        ${bodyMarkup}
      </div>
    </div>
    ${options.url
      ? `<div class="postline-toast__actions">
          <a class="postline-toast__btn postline-toast__btn--primary" href="${escapeHtml(options.url)}" target="_blank" rel="noopener noreferrer">Open on Bluesky</a>
          <button type="button" class="postline-toast__btn postline-toast__btn--secondary" data-toast-copy>Copy link</button>
        </div>`
      : ''}
  `

  toast.querySelector('[data-toast-dismiss]')?.addEventListener('click', () => dismissToast(toast, options.id))
  toast.querySelector('[data-toast-copy]')?.addEventListener('click', async () => {
    if (!options.url) return
    try {
      await navigator.clipboard.writeText(options.url)
      showPostlineToast({ title: 'Copied', message: 'Link copied to clipboard.', tone: 'success', durationMs: 2800 })
    }
    catch {
      showPostlineToast({ title: 'Copy failed', message: 'Could not copy the link.', tone: 'error', durationMs: 5000 })
    }
  })

  if (options.id) toastRegistry.set(options.id, toast)

  host().prepend(toast)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('is-visible'))
  })

  if (durationMs > 0) {
    window.setTimeout(() => dismissToast(toast, options.id), durationMs)
  }
}

declare global {
  interface Window {
    postlineToast?: {
      show: typeof showPostlineToast
      dismiss: typeof dismissToastById
    }
  }
}

window.postlineToast = { show: showPostlineToast, dismiss: dismissToastById }
