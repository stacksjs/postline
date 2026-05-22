export type PostlineToastTone = 'neutral' | 'success' | 'error' | 'info'

export interface PostlineToastOptions {
  title?: string
  message: string
  tone?: PostlineToastTone
  url?: string
  durationMs?: number
}

const ICONS: Record<PostlineToastTone, string> = {
  success: 'i-hugeicons-checkmark-circle-02',
  error: 'i-hugeicons-alert-circle',
  info: 'i-hugeicons-information-circle',
  neutral: 'i-hugeicons-notification-03',
}

const TONE_STYLES: Record<PostlineToastTone, string> = {
  success: 'border-emerald-200/90 bg-emerald-50 text-emerald-950',
  error: 'border-red-200/90 bg-red-50 text-red-950',
  info: 'border-blue-200/90 bg-blue-50 text-blue-950',
  neutral: 'border-zinc-200/90 bg-white text-neutral-950',
}

function host(): HTMLElement {
  let element = document.getElementById('postline-toast-host')
  if (!element) {
    element = document.createElement('div')
    element.id = 'postline-toast-host'
    element.className = 'fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none max-w-md w-[calc(100%-3rem)] sm:w-[22rem]'
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

function dismissToast(toast: HTMLElement): void {
  toast.classList.add('opacity-0', 'translate-y-1')
  window.setTimeout(() => toast.remove(), 180)
}

export function showPostlineToast(options: PostlineToastOptions): void {
  const tone = options.tone ?? 'neutral'
  const title = options.title ?? (tone === 'success' ? 'Done' : tone === 'error' ? 'Something went wrong' : 'Postline')
  const durationMs = options.durationMs ?? (tone === 'error' ? 12000 : 9000)

  const toast = document.createElement('div')
  toast.className = `pointer-events-auto grid gap-3 p-3.5 border rounded-2xl shadow-[0_18px_54px_rgba(24,31,42,0.16)] transition-all duration-200 ${TONE_STYLES[tone]}`
  toast.setAttribute('role', 'status')

  const linkBlock = options.url
    ? `<div class="grid gap-1.5">
        <p class="m-0 text-sm leading-snug text-inherit/90">${escapeHtml(options.message)}</p>
        <a class="block font-medium text-sm text-blue-700 underline underline-offset-2 break-all hover:text-blue-900" href="${escapeHtml(options.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(options.url)}</a>
      </div>`
    : `<p class="m-0 text-sm leading-snug text-inherit/90">${escapeHtml(options.message)}</p>`

  toast.innerHTML = `
    <div class="flex gap-3 items-start">
      <span class="grid place-items-center shrink-0 h-9 w-9 rounded-xl bg-white/70 border border-black/5">
        <span class="h-5 w-5 ${ICONS[tone]}" aria-hidden="true"></span>
      </span>
      <div class="grid flex-1 gap-1 min-w-0">
        <div class="flex gap-2 items-start justify-between">
          <strong class="text-sm font-bold">${escapeHtml(title)}</strong>
          <button type="button" class="shrink-0 grid place-items-center h-7 w-7 text-inherit/60 hover:text-inherit rounded-lg hover:bg-black/5" aria-label="Dismiss notification" data-toast-dismiss>
            <span class="h-4 w-4 i-hugeicons-cancel-01" aria-hidden="true"></span>
          </button>
        </div>
        ${linkBlock}
      </div>
    </div>
    ${options.url
      ? `<div class="flex flex-wrap gap-2">
          <a class="inline-flex items-center justify-center px-3 h-8 text-xs font-bold text-white bg-neutral-950 rounded-lg" href="${escapeHtml(options.url)}" target="_blank" rel="noopener noreferrer">Open on Bluesky</a>
          <button type="button" class="inline-flex items-center justify-center px-3 h-8 text-xs font-bold text-neutral-950 bg-white border border-zinc-200 rounded-lg" data-toast-copy>Copy link</button>
        </div>`
      : ''}
  `

  toast.querySelector('[data-toast-dismiss]')?.addEventListener('click', () => dismissToast(toast))
  toast.querySelector('[data-toast-copy]')?.addEventListener('click', async () => {
    if (!options.url) return
    try {
      await navigator.clipboard.writeText(options.url)
      showPostlineToast({ title: 'Copied', message: 'Post link copied to clipboard.', tone: 'success', durationMs: 3500 })
    }
    catch {
      showPostlineToast({ title: 'Copy failed', message: 'Could not copy the link.', tone: 'error', durationMs: 5000 })
    }
  })

  host().prepend(toast)
  window.setTimeout(() => dismissToast(toast), durationMs)
}

declare global {
  interface Window {
    postlineToast?: {
      show: typeof showPostlineToast
    }
  }
}

window.postlineToast = { show: showPostlineToast }
