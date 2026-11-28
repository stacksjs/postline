import type { EngagementCounts } from '../../app/Support/Social/engagement-analytics'

export interface XBrowserWindow {
  openExternal: (options: { name: string, url: string, title: string, dataStore: string }) => Promise<{ name: string }>
  _call: {
    (action: 'executeJavaScript', input: { code: string }, name: string): Promise<unknown>
    (action: 'loadURL', input: { url: string }, name: string): void | Promise<unknown>
  }
}

interface XBrowserPost {
  id: string
  authorHandle: string
  body: string
  postedAt: string
}

type XBrowserRead = 'sign-in' | 'listening' | 'metrics'

type XBrowserStatus =
  | { state: 'connected', handle: string, measurements: Array<{ id: string, counts: EngagementCounts }>, posts?: XBrowserPost[], readIssue?: 'layout' | 'loading' }
  | { state: 'signed-out' | 'needs-attention' | 'unavailable' }

export function xBrowserWindow(host: unknown): XBrowserWindow | null {
  const browser = (host as { window?: Partial<XBrowserWindow> } | null)?.window
  return typeof browser?.openExternal === 'function' && typeof browser._call === 'function'
    ? browser as XBrowserWindow
    : null
}

export async function openXBrowser(browser: XBrowserWindow, profile: string, url = 'https://x.com/home'): Promise<void> {
  await browser.openExternal({
    name: profile,
    url,
    title: 'X browser session',
    dataStore: profile,
  })
}

export async function removeXBrowserProfile(host: unknown, profile: string): Promise<'removed' | 'unsupported' | 'busy'> {
  const browser = (host as { window?: {
    removeDataStore?: (name: string) => Promise<void>
    _call?: (action: 'destroy', input: undefined, name: string) => Promise<void>
  } } | null)?.window
  if (typeof browser?.removeDataStore !== 'function' || typeof browser._call !== 'function')
    return 'unsupported'

  function hasCode(error: unknown, code: string): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
  }

  const removeDataStore = browser.removeDataStore.bind(browser)
  const remove = async (): Promise<'removed' | 'busy'> => {
    try {
      await removeDataStore(profile)
      return 'removed'
    }
    catch (error) {
      if (hasCode(error, 'BUSY')) return 'busy'
      throw error
    }
  }

  // An unused profile has no named window. Remove it directly and release
  // our own view only if Craft reports that the data store is still in use.
  const first = await remove()
  if (first === 'removed') return first
  try {
    await browser._call('destroy', undefined, profile)
  }
  catch (error) {
    // The named view may already be gone. Craft still checks every other
    // view before reporting that the store has been removed.
    if (!hasCode(error, 'INVALID_PARAMETER')) throw error
  }
  return await remove()
}

/** Read the account and the requested data from the open X page. */
export function inspectXPage(page: Document, href: string, read: XBrowserRead = 'sign-in'): XBrowserStatus {
  const url = new URL(href)
  if (!['https://x.com', 'https://twitter.com'].includes(url.origin))
    return { state: 'unavailable' }
  if (/^\/account\/access(?:\/|$)/.test(url.pathname) || page.querySelector('[data-testid="ocfEnterTextTextInput"]'))
    return { state: 'needs-attention' }
  // X can keep the account sidebar mounted while opening its sign-in flow.
  if (/^\/(?:login|i\/flow\/login)(?:\/|$)/.test(url.pathname)
    || (/^\/i\/jf\/onboarding\/web\/?$/.test(url.pathname) && url.searchParams.get('mode') === 'login')) {
    return { state: 'signed-out' }
  }

  const profileLink = (page.querySelector('a[data-testid="AppTabBar_Profile_Link"]')
    ?? page.querySelector('nav a[aria-label="Profile"]'))?.getAttribute('href')
  if (profileLink) {
    const profile = new URL(profileLink, url)
    const handle = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(profile.pathname)?.[1]
    if (profile.origin === url.origin && handle) {
      const measurements: Array<{ id: string, counts: EngagementCounts }> = []
      const listening = read === 'listening' && ['/search', '/notifications/mentions'].includes(url.pathname)
      const column = listening ? page.querySelector('[data-testid="primaryColumn"]') : null
      if (listening && !column)
        return { state: 'connected', handle, measurements, readIssue: 'loading' }

      const posts: XBrowserPost[] | undefined = listening ? [] : undefined
      let recognizedPost = false
      if (read === 'metrics' || listening) {
        const timeline = column ?? page
        const articles = timeline.querySelectorAll('article[data-testid="tweet"], [data-navigation-stop] > article')
        for (const article of Array.from(articles).slice(0, 100)) {
          if (!article.getClientRects().length) continue
          const time = article.querySelector('time')
          // X's newer timeline puts the canonical status link beside the
          // article, under the row navigation control.
          const path = article.parentElement?.querySelector(':scope[data-navigation-stop] > a[aria-hidden="true"][href]')?.getAttribute('href')
            ?? time?.closest('a')?.getAttribute('href')
          const post = path ? new URL(path, url) : null
          const match = post && /^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,19})\/?$/.exec(post.pathname)
          if (!post || post.origin !== url.origin || !match?.[1] || !match[2]) continue
          const [, authorHandle, id] = match
          if (posts) {
            recognizedPost = true
            const body = article.querySelector<HTMLElement>('[data-testid="tweetText"]')?.innerText.trim()
            const postedAt = time?.getAttribute('datetime')
            if (body && postedAt) posts.push({ id, authorHandle, body: body.slice(0, 10000), postedAt })
            continue
          }
          if (authorHandle.toLowerCase() !== handle.toLowerCase()) continue

          const counts: EngagementCounts = {}
          const selectors = {
            likes: '[data-testid="like"], [data-testid="unlike"], [data-engagement-action="like"] button',
            replies: '[data-testid="reply"], [data-engagement-action="reply"] a, [data-engagement-action="reply"] button',
            reposts: '[data-testid="retweet"], [data-testid="unretweet"], [data-engagement-action="retweet"] button',
            views: 'a[href$="/analytics"], button[aria-label="View count"]',
          } as const
          for (const [field, selector] of Object.entries(selectors)) {
            const control = article.querySelector(selector)
            if (!control?.getClientRects().length || control.closest('article') !== article) continue
            const visible = (control.textContent ?? '').trim()
            const labelled = /^(\d+(?:,\d{3})*)\s+(?:likes?|replies|reply|reposts?|views?)\b/i.exec(control.getAttribute('aria-label') ?? '')?.[1]
            const count = labelled ?? (/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(visible) ? visible : undefined)
            const number = count === undefined ? NaN : Number(count.replaceAll(',', ''))
            if (Number.isSafeInteger(number)) counts[field as keyof typeof selectors] = number
          }
          if (Object.keys(counts).length) measurements.push({ id, counts })
        }
      }
      if (column && !recognizedPost) {
        // An empty result can confirm the layout only once X has rendered
        // its empty state. A column without results may still be loading.
        if (Array.from(column.querySelectorAll('article')).slice(0, 100).some(article => article.getClientRects().length))
          return { state: 'connected', handle, measurements, readIssue: 'layout' }
        if (!column.querySelector('[data-testid="emptyState"]')?.getClientRects().length)
          return { state: 'connected', handle, measurements, readIssue: 'loading' }
      }
      return { state: 'connected', handle, measurements, ...(posts && { posts }) }
    }
  }

  if (page.querySelector('[data-testid="loginButton"], [data-interaction="mobile-top-bar-log-in"]'))
    return { state: 'signed-out' }
  return { state: 'unavailable' }
}

export async function readXBrowserSession(browser: XBrowserWindow, profile: string, read: XBrowserRead = 'sign-in'): Promise<XBrowserStatus> {
  try {
    const result = await browser._call('executeJavaScript', {
      code: `JSON.stringify((${inspectXPage.toString()})(document, location.href, ${JSON.stringify(read)}))`,
    }, profile)
    if (typeof result !== 'string') return { state: 'unavailable' }
    const status: XBrowserStatus = JSON.parse(result)
    if (status.state === 'connected' && typeof status.handle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(status.handle)) return status
    if (status.state === 'signed-out' || status.state === 'needs-attention') return status
  }
  catch {}
  return { state: 'unavailable' }
}
