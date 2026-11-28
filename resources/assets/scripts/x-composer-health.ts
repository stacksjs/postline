import type { XBrowserWindow } from '../../functions/x-browser-session'
import { requestJson } from '../../functions/postline-client'
import { inspectXPage, withXBrowserProfile, xComposerWindowName } from '../../functions/x-browser-session'

type ComposerHealth = 'ready' | 'layout' | 'unavailable' | 'attention'
const endpoint = '/api/postline/twitter/browser-session/composer-check'
const composerUrl = 'https://x.com/compose/post'

// Runs inside the isolated X window. The account check is supplied with the
// script so it uses the same signs of a challenge as Listening and Analytics.
export function inspectXComposer(page: Document, href: string, expectedHandle: string, inspectAccount = inspectXPage): ComposerHealth {
  const account = inspectAccount(page, href)
  if (account.state === 'needs-attention' || account.state === 'signed-out') return 'attention'
  if (account.state !== 'connected') return 'unavailable'
  if (account.handle.toLowerCase() !== expectedHandle.toLowerCase()) return 'attention'
  if (!/^\/compose\/post\/?$/.test(new URL(href).pathname)) return 'unavailable'

  const dialog = page.querySelector('[role="dialog"]')
  const editor = dialog?.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]')
  const submit = dialog?.querySelector('button[data-testid="tweetButton"], button[data-testid="tweetButtonInline"]')
  const attachment = dialog?.querySelector('input[type="file"][data-testid="fileInput"]')
  if (editor?.getClientRects().length && submit?.getClientRects().length && attachment) return 'ready'
  return page.readyState === 'loading' || page.querySelector('[role="progressbar"]') ? 'unavailable' : 'layout'
}

export function checkXComposer(
  browser: XBrowserWindow,
  sleep: (delayMs: number, options: { signal: AbortSignal }) => Promise<void>,
  signal: AbortSignal,
): Promise<boolean> {
  return withXBrowserProfile(() => runCheck(browser, sleep, signal), signal)
}

async function runCheck(
  browser: XBrowserWindow,
  sleep: (delayMs: number, options: { signal: AbortSignal }) => Promise<void>,
  signal: AbortSignal,
): Promise<boolean> {
  const { data } = await requestJson(endpoint, { method: 'POST', body: JSON.stringify({ begin: true }), signal })
  if (!data || signal.aborted) return false
  const { handle, profile, token } = data as { handle: string, profile: string, token: string }
  const name = xComposerWindowName(profile)
  const code = `(${inspectXComposer.toString()})(document, location.href, ${JSON.stringify(handle)}, ${inspectXPage.toString()})`
  let opened = false
  let keepOpen = false
  try {
    let health: ComposerHealth = 'unavailable'
    try {
      await browser.openExternal({ name, url: composerUrl, title: 'X Composer check', dataStore: profile, headless: true })
      opened = true
      for (const delay of [0, 750, 1250, 2000, 3000]) {
        if (delay) await sleep(delay, { signal })
        if (signal.aborted) return false
        const result = await browser._call('executeJavaScript', { code }, name).catch(() => null)
        if (result === 'ready' || result === 'attention') {
          health = result
          break
        }
        health = result === 'layout' ? 'layout' : 'unavailable'
      }
    }
    catch {
      if (signal.aborted) return false
    }
    const reported = await requestJson(endpoint, { method: 'POST', body: JSON.stringify({ token, health }), signal })
    if (reported.data?.recorded && health === 'attention') {
      await browser._call('show', undefined, name)
      keepOpen = true
    }
    return reported.data?.recorded === true
  }
  finally {
    if (opened && !keepOpen) await browser._call('destroy', undefined, name).catch(() => {})
  }
}
