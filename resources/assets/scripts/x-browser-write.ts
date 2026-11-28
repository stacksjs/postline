import type { XBrowserWrite, XBrowserWriteResult } from '../../../app/Support/Social/x-browser-write'
import type { XBrowserWindow } from '../../functions/x-browser-session'
import { requestJson } from '../../functions/postline-client'
import { inspectXPage, withXBrowserProfile, xComposerWindowName } from '../../functions/x-browser-session'
import { inspectXComposer } from './x-composer-health'

type Stage = 'prepare' | 'ready' | 'submit' | 'result'
type BrowserResult = XBrowserWriteResult | { state: 'prepared' | 'ready' | 'waiting' }
interface PublishProbe {
  token: string
  text: string
  imageCount: number
  submitted: boolean
  result?: XBrowserWriteResult
  restore?: () => void
}
const endpoint = '/api/postline/twitter/browser-session/publish'

function publishedId(payload: any): string | null {
  const result = payload?.data?.create_tweet?.tweet_results?.result
    ?? payload?.data?.create_note_tweet?.tweet_results?.result
  const id = result?.rest_id ?? result?.tweet?.rest_id
  return typeof id === 'string' && /^[1-9][0-9]{0,18}$/.test(id) ? id : null
}

// Runs in the native child window. The window uses X's own client and observes
// only the response to the submission X makes when its Post button is clicked.
function runXWrite(
  page: Document,
  href: string,
  stage: Stage,
  work: Pick<XBrowserWrite, 'token' | 'handle'> & Partial<Pick<XBrowserWrite, 'text' | 'images'>>,
  checkComposer: typeof inspectXComposer,
  checkAccount: typeof inspectXPage,
  postId: typeof publishedId,
): BrowserResult {
  const view = page.defaultView as (Window & { __postlineXPublish?: PublishProbe }) | null
  if (!view) return { state: 'unavailable' }
  const previous = view.__postlineXPublish
  if (stage === 'result' && previous?.token === work.token && previous.result) {
    previous.restore?.()
    return previous.result
  }
  const health = checkComposer(page, href, work.handle, checkAccount)
  if (health === 'attention') {
    previous?.restore?.()
    return { state: 'attention' }
  }
  if (stage === 'result') return { state: 'waiting' }
  if (health !== 'ready') return { state: health }

  const dialog = page.querySelector('[role="dialog"]')!
  const editor = dialog.querySelector<HTMLElement>('[data-testid="tweetTextarea_0"][contenteditable="true"]')!
  const submit = dialog.querySelector<HTMLButtonElement>('button[data-testid="tweetButton"], button[data-testid="tweetButtonInline"]')!
  const attachment = dialog.querySelector<HTMLInputElement>('input[type="file"][data-testid="fileInput"]')!
  if (stage === 'prepare') {
    if (previous || editor.innerText.trim() || !work.text) return { state: 'unavailable' }
    editor.focus()
    page.execCommand('insertText', false, work.text)
    if (editor.innerText.trim() !== work.text.trim()) return { state: 'layout' }
    view.__postlineXPublish = { token: work.token, text: work.text.trim(), imageCount: work.images?.length ?? 0, submitted: false }
    if (work.images?.length) {
      const transfer = new DataTransfer()
      for (const [index, image] of work.images.entries()) {
        const bytes = Uint8Array.from(atob(image.base64), char => char.charCodeAt(0))
        const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.slice('image/'.length)
        transfer.items.add(new File([bytes], `postline-${index + 1}.${extension}`, { type: image.type }))
      }
      attachment.files = transfer.files
      attachment.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return { state: 'prepared' }
  }
  if (previous?.token !== work.token || previous.submitted) return { state: 'uncertain' }
  if (editor.innerText.trim() !== previous.text) return { state: 'layout' }
  if (submit.disabled || submit.getAttribute('aria-disabled') === 'true') return { state: 'waiting' }
  if (dialog.querySelector('[role="progressbar"]')) return { state: 'waiting' }
  if (previous.imageCount && dialog.querySelectorAll('[data-testid="attachments"] img').length !== previous.imageCount)
    return { state: 'waiting' }
  if (stage === 'ready') return { state: 'ready' }

  const observe = async (url: string, method: string, status: number, data: () => Promise<unknown>) => {
    const request = new URL(url, href)
    if (request.origin !== new URL(href).origin || method.toUpperCase() !== 'POST'
      || !/\/graphql\/[^/]+\/(?:CreateTweet|CreateNoteTweet)\/?$/.test(request.pathname)) return
    try {
      const payload = await data()
      if (status >= 200 && status < 300) {
        const id = postId(payload)
        if (id) previous.result = { state: 'published', id }
      }
      else if ([400, 401, 403, 422].includes(status) && payload && typeof payload === 'object'
        && 'errors' in payload && Array.isArray(payload.errors) && payload.errors.length) {
        previous.result = { state: 'refused' }
      }
    }
    catch {}
  }
  const originalFetch = view.fetch
  const fetch = originalFetch.bind(view)
  previous.restore = () => { view.fetch = originalFetch }
  view.fetch = async (input, options) => {
    const response = await fetch(input, options)
    const url = input instanceof Request ? input.url : String(input)
    const method = options?.method ?? (input instanceof Request ? input.method : 'GET')
    void observe(url, method, response.status, () => response.clone().json())
    return response
  }
  previous.submitted = true
  submit.click()
  return { state: 'waiting' }
}

export function bindXBrowserWrites(
  browser: XBrowserWindow,
  sleep: (delay: number, options: { signal: AbortSignal }) => Promise<void>,
  signal: AbortSignal,
): void {
  async function execute(work: XBrowserWrite): Promise<void> {
    const name = xComposerWindowName(work.profile)
    async function run(stage: Stage): Promise<BrowserResult> {
      const input = stage === 'prepare' ? work : { token: work.token, handle: work.handle }
      const code = `JSON.stringify((${runXWrite.toString()})(document, location.href, ${JSON.stringify(stage)}, ${JSON.stringify(input)}, ${inspectXComposer.toString()}, ${inspectXPage.toString()}, ${publishedId.toString()}))`
      const result = await browser._call('executeJavaScript', { code }, name)
      return typeof result === 'string' ? JSON.parse(result) : { state: 'unavailable' }
    }
    let keepOpen = false
    let opened = false
    let authorized = false
    let outcome: XBrowserWriteResult = { state: 'unavailable' }
    try {
      await browser.openExternal({ name, url: 'https://x.com/compose/post', title: 'Publish to X', dataStore: work.profile, headless: true })
      opened = true
      let state: BrowserResult = { state: 'unavailable' }
      for (let attempt = 0; attempt < 12; attempt++) {
        if (attempt) await sleep(500, { signal })
        state = await run('prepare').catch(() => ({ state: 'unavailable' } as const))
        if (state.state === 'prepared' || state.state === 'attention') break
      }
      if (state.state === 'prepared') {
        for (let attempt = 0; attempt < 18; attempt++) {
          state = await run('ready')
          if (state.state !== 'waiting') break
          await sleep(500, { signal })
        }
      }
      if (state.state === 'ready' && !signal.aborted) {
        const grant = await requestJson(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'authorize', token: work.token }), signal })
        authorized = grant.data === true
        if (authorized && !signal.aborted) {
          await run('submit')
          for (let attempt = 0; attempt < 28; attempt++) {
            state = await run('result')
            if (state.state !== 'waiting') break
            await sleep(500, { signal })
          }
        }
      }
      if (state.state === 'attention' || state.state === 'published' || state.state === 'refused' || state.state === 'layout') outcome = state
      else if (authorized) outcome = { state: 'uncertain' }
    }
    catch {
      if (authorized) outcome = { state: 'uncertain' }
    }
    try {
      const result = await requestJson(endpoint, {
        method: 'POST', body: JSON.stringify({ operation: 'result', token: work.token, result: outcome }), signal,
      })
      if (result.data && outcome.state === 'attention') {
        await browser._call('show', undefined, name)
        keepOpen = true
      }
    }
    finally {
      if (opened && !keepOpen) await browser._call('destroy', undefined, name).catch(() => {})
    }
  }

  async function poll(): Promise<void> {
    while (!signal.aborted) {
      try {
        await withXBrowserProfile(async () => {
          const { data } = await requestJson(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'claim' }), signal })
          if (data) await execute(data)
        }, signal)
      }
      catch {}
      if (!signal.aborted) await sleep(4000, { signal })
    }
  }
  void poll().catch(() => {})
}
