import type { EngagementCounts } from '../../app/Support/Social/engagement-analytics'

export interface XBrowserWindow {
  openExternal: (options: { name: string, url: string, title: string, dataStore: string }) => Promise<{ name: string }>
  _call: (action: 'executeJavaScript', input: { code: string }, name: string) => Promise<unknown>
}

type XBrowserStatus =
  | { state: 'connected', handle: string, measurements: Array<{ id: string, counts: EngagementCounts }> }
  | { state: 'signed-out' | 'needs-attention' | 'unavailable' }

export function xBrowserWindow(host: unknown): XBrowserWindow | null {
  const browser = (host as { window?: Partial<XBrowserWindow> } | null)?.window
  return typeof browser?.openExternal === 'function' && typeof browser._call === 'function'
    ? browser as XBrowserWindow
    : null
}

export async function openXBrowser(browser: XBrowserWindow, profile: string): Promise<void> {
  await browser.openExternal({
    name: profile,
    url: 'https://x.com/home',
    title: 'X browser session',
    dataStore: profile,
  })
}

/** Read the visible X account and, on request, engagement on its rendered posts. */
export function inspectXPage(page: Document, href: string, includeMetrics = false): XBrowserStatus {
  const url = new URL(href)
  if (!['https://x.com', 'https://twitter.com'].includes(url.origin))
    return { state: 'unavailable' }
  if (url.pathname.startsWith('/account/access') || page.querySelector('[data-testid="ocfEnterTextTextInput"]'))
    return { state: 'needs-attention' }

  const profileLink = page.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')
  if (profileLink) {
    const profile = new URL(profileLink, url)
    const handle = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(profile.pathname)?.[1]
    if (profile.origin === url.origin && handle) {
      const measurements: Array<{ id: string, counts: EngagementCounts }> = []
      if (includeMetrics) {
        for (const article of Array.from(page.querySelectorAll('article[data-testid="tweet"]')).slice(0, 100)) {
          if (!article.getClientRects().length) continue
          const path = article.querySelector('time')?.closest('a')?.getAttribute('href')
          const post = path ? new URL(path, url) : null
          const match = post && /^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,19})\/?$/.exec(post.pathname)
          if (!post || post.origin !== url.origin || !match || match[1]?.toLowerCase() !== handle.toLowerCase()) continue

          const counts: EngagementCounts = {}
          const selectors = {
            likes: '[data-testid="like"], [data-testid="unlike"]',
            replies: '[data-testid="reply"]',
            reposts: '[data-testid="retweet"], [data-testid="unretweet"]',
            views: 'a[href$="/analytics"]',
          } as const
          for (const [field, selector] of Object.entries(selectors)) {
            const control = article.querySelector(selector)
            if (!control?.getClientRects().length) continue
            const visible = (control.textContent ?? '').trim()
            const labelled = /^(\d+(?:,\d{3})*)\s+(?:likes?|replies|reply|reposts?|views?)\b/i.exec(control.getAttribute('aria-label') ?? '')?.[1]
            const count = labelled ?? (/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(visible) ? visible : undefined)
            const number = count === undefined ? NaN : Number(count.replaceAll(',', ''))
            if (Number.isSafeInteger(number)) counts[field as keyof typeof selectors] = number
          }
          if (Object.keys(counts).length) measurements.push({ id: match[2]!, counts })
        }
      }
      return { state: 'connected', handle, measurements }
    }
  }

  if (url.pathname === '/login' || url.pathname === '/i/flow/login' || page.querySelector('[data-testid="loginButton"]'))
    return { state: 'signed-out' }
  return { state: 'unavailable' }
}

export async function readXBrowserSession(browser: XBrowserWindow, profile: string, includeMetrics = false): Promise<XBrowserStatus> {
  try {
    const result = await browser._call('executeJavaScript', {
      code: `JSON.stringify((${inspectXPage.toString()})(document, location.href, ${includeMetrics}))`,
    }, profile)
    if (typeof result !== 'string') return { state: 'unavailable' }
    const status: XBrowserStatus = JSON.parse(result)
    if (status.state === 'connected' && typeof status.handle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(status.handle)) return status
    if (status.state === 'signed-out' || status.state === 'needs-attention') return status
  }
  catch {}
  return { state: 'unavailable' }
}
