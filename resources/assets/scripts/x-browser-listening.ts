import type { XBrowserWindow } from '../../functions/x-browser-session'
import { requestJson } from '../../functions/postline-client'
import { readXBrowserSession, withXBrowserProfile, xListeningWindowName } from '../../functions/x-browser-session'

const endpoint = '/api/postline/twitter/browser-session/listening-check'

export function scanXListening(
  browser: XBrowserWindow,
  sleep: (delay: number, options: { signal: AbortSignal }) => Promise<void>,
  signal: AbortSignal,
): Promise<boolean> {
  return withXBrowserProfile(async () => {
    const { data } = await requestJson(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'claim' }), signal })
    if (!data || signal.aborted) return false

    const { token, profile, handle, query } = data as { token: string, profile: string, handle: string, query: string }
    const name = xListeningWindowName(profile)
    const url = new URL('https://x.com/search')
    url.search = new URLSearchParams({ q: query, f: 'live' }).toString()
    let opened = false
    let keepOpen = false
    try {
      let state: 'attention' | 'layout' | 'captured' | 'unavailable' = 'unavailable'
      let posts: unknown[] | undefined
      try {
        await browser.openExternal({ name, url: url.href, title: 'X Listening check', dataStore: profile, headless: true })
        opened = true
        for (const delay of [0, 750, 1250, 2000, 3000, 3000]) {
          if (delay) await sleep(delay, { signal })
          if (signal.aborted) return false

          const page = await readXBrowserSession(browser, name, 'listening', query)
          if (page.state === 'signed-out' || page.state === 'needs-attention'
            || (page.state === 'connected' && page.handle.toLowerCase() !== handle.toLowerCase())) {
            state = 'attention'
            break
          }
          if (page.state === 'connected' && page.posts && !page.readIssue) {
            state = 'captured'
            posts = page.posts
            break
          }
          state = page.state === 'connected' && page.readIssue === 'layout' ? 'layout' : 'unavailable'
        }
      }
      catch {
        if (signal.aborted) return false
      }
      const settled = await requestJson(endpoint, {
        method: 'POST', body: JSON.stringify({ operation: 'finish', token, handle, state, posts }), signal,
      })
      if (settled.data?.recorded && state === 'attention') {
        await browser._call('show', undefined, name)
        keepOpen = true
      }
      return settled.data?.recorded === true
    }
    finally {
      if (opened && !keepOpen) await browser._call('destroy', undefined, name).catch(() => {})
    }
  }, signal)
}
