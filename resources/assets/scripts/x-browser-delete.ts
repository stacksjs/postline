import type { XBrowserWindow } from '../../functions/x-browser-session'
import { requestJson } from '../../functions/postline-client'
import { inspectXPage, withXBrowserProfile, xComposerWindowName } from '../../functions/x-browser-session'

type Stage = 'open' | 'ready' | 'select' | 'result'
type Outcome = 'deleted' | 'refused' | 'attention' | 'uncertain'
type Status = Outcome | 'open' | 'ready' | 'waiting'
interface DeleteTarget {
  receipt: string
  profile: string
  handle: string
  id: string
}
interface DeleteProbe {
  id: string
  selected: boolean
  confirmed: boolean
  requested?: boolean
  outcome?: Outcome
  restore?: () => void
}
const endpoint = '/api/postline/queue/delete-x-browser-post'

// Evaluated in the isolated window. Observe X's own Delete request and response;
// the application never sends a mutation to X itself.
function usePostMenu(page: Document, href: string, stage: Stage, work: Pick<DeleteTarget, 'handle' | 'id'>, inspect: typeof inspectXPage): Status {
  const view = page.defaultView as (Window & { __postlineXDelete?: DeleteProbe }) | null
  if (!view) return 'waiting'
  const previous = view.__postlineXDelete
  if (stage === 'result' && previous?.id === work.id && previous.outcome) {
    previous.restore?.()
    return previous.outcome
  }

  const session = inspect(page, href, 'post')
  if (session.state === 'needs-attention' || session.state === 'signed-out'
    || (session.state === 'connected' && session.handle.toLowerCase() !== work.handle)) return 'attention'
  if (session.state !== 'connected' || session.posts?.length !== 1 || session.posts[0]?.id !== work.id) return 'waiting'
  const address = new URL(href)
  const expected = `/${work.handle}/status/${work.id}`
  const visible = (element: Element) => element.getClientRects().length > 0
  const deleteLabel = /^(?:delete|borrar|eliminar)(?: (?:post|publicación))?$/i
  if (stage === 'open') {
    if (previous?.id === work.id) return 'open'
    const matched = Array.from(page.querySelectorAll('article[data-testid="tweet"], [data-navigation-stop] > article')).filter((article) => {
      if (!visible(article)) return false
      const time = article.querySelector('time')
      if (time?.closest('article') !== article) return false
      const link = article.parentElement?.querySelector(':scope[data-navigation-stop] > a[aria-hidden="true"][href]') ?? time.closest('a')
      const path = link?.getAttribute('href')
      const post = path && new URL(path, address)
      return post && post.origin === address.origin && post.pathname.toLowerCase().replace(/\/$/, '') === expected
    })
    const menu = matched.length === 1 ? matched[0]?.querySelector<HTMLElement>('[data-testid="caret"]') : null
    if (!menu || !visible(menu) || menu.closest('article') !== matched[0]) return 'waiting'
    view.__postlineXDelete = { id: work.id, selected: false, confirmed: false }
    menu.click()
    return 'open'
  }

  if (previous?.id !== work.id) return 'waiting'
  if (stage === 'result') {
    if (!previous.selected || previous.confirmed) return 'waiting'
    const sheet = page.querySelector('[data-testid="confirmationSheetDialog"]')
    const button = sheet?.querySelector<HTMLElement>('[data-testid="confirmationSheetConfirm"]')
    if (!button || !visible(button) || !deleteLabel.test(button.innerText.trim())
      || button.matches(':disabled, [aria-disabled="true"]')) return 'waiting'
    previous.confirmed = true
    button.click()
    return 'waiting'
  }

  const openSheet = page.querySelector('[data-testid="confirmationSheetDialog"]')
  if (openSheet && visible(openSheet)) return 'waiting'
  const choices = Array.from(page.querySelectorAll<HTMLElement>('[data-testid="Dropdown"] [role="menuitem"], [role="menu"] [role="menuitem"]'))
    .filter(item => visible(item) && (item.dataset.testid === 'deleteTweet' || deleteLabel.test(item.innerText.trim())))
  if (choices.length !== 1 || previous.selected || choices[0]!.matches(':disabled, [aria-disabled="true"]')) return 'waiting'
  if (stage === 'ready') return 'ready'

  const originalFetch = view.fetch
  const send = originalFetch.bind(view)
  previous.restore = () => { view.fetch = originalFetch }
  view.fetch = async (input, options) => {
    const request = new URL(input instanceof Request ? input.url : String(input), href)
    const method = options?.method ?? (input instanceof Request ? input.method : 'GET')
    const matching = request.origin === address.origin && method.toUpperCase() === 'POST'
      && /\/graphql\/[^/]+\/DeleteTweet\/?$/.test(request.pathname)
    if (!matching) return send(input, options)

    let id: unknown
    try {
      const requestData = options?.body === undefined && input instanceof Request
        ? await input.clone().json() : typeof options?.body === 'string' ? JSON.parse(options.body) : null
      id = requestData?.variables?.tweet_id
    }
    catch {}
    if (id !== work.id || previous.requested) {
      previous.requested = true
      throw new TypeError('The X deletion request did not match the authorized post.')
    }
    previous.requested = true
    const response = await send(input, options)
    const body = response.clone()
    void (async () => {
      try {
        const payload = await body.json()
        if (response.ok && !payload?.errors?.length && payload?.data?.delete_tweet?.tweet_results)
          previous.outcome = 'deleted'
        else if ([400, 401, 403, 422].includes(response.status) && Array.isArray(payload?.errors) && payload.errors.length)
          previous.outcome = 'refused'
      }
      catch {}
    })()
    return response
  }
  previous.selected = true
  choices[0]!.click()
  return 'waiting'
}

export function deleteXBrowserPost(browser: XBrowserWindow, targetId: number): Promise<Outcome | 'unavailable'> {
  return withXBrowserProfile(async () => {
    const call = (operation: string, input: object = {}) =>
      requestJson(endpoint, { method: 'POST', body: JSON.stringify({ operation, target_id: targetId, ...input }) })
    const { data: target } = await call('prepare') as { data: DeleteTarget }
    const name = xComposerWindowName(target.profile)
    const url = `https://x.com/${target.handle}/status/${target.id}`
    const input = JSON.stringify({ handle: target.handle, id: target.id })
    async function read(stage: Stage): Promise<Status> {
      const code = `(${usePostMenu.toString()})(document, location.href, ${JSON.stringify(stage)}, ${input}, ${inspectXPage.toString()})`
      return await browser._call('executeJavaScript', { code }, name).catch(() => 'waiting') as Status
    }
    async function wait(stage: Stage, checks: number): Promise<Status> {
      for (let check = 0; check < checks; check++) {
        const status = await read(stage)
        if (status !== 'waiting') return status
        await new Promise(resolve => setTimeout(resolve, 400))
      }
      return 'waiting'
    }

    let keepOpen = false
    let token: string | undefined
    await browser.openExternal({ name, url, title: 'Delete X post', dataStore: target.profile, headless: true })
    try {
      const opened = await wait('open', 16)
      let result = opened === 'open' ? await wait('ready', 12) : opened
      if (result === 'ready') {
        const grant = await call('authorize', { receipt: target.receipt })
        if (typeof grant.data !== 'string') return 'unavailable'
        token = grant.data
        const selected = await read('select')
        result = selected === 'attention' ? selected : await wait('result', 36)
      }
      const recorded = token
        ? await call('result', { token, state: result === 'waiting' ? 'uncertain' : result })
        : result === 'attention' ? await call('attention', { receipt: target.receipt }) : null
      if (result === 'attention' && recorded?.data) {
        await browser._call('show', undefined, name)
        keepOpen = true
      }
      if (result === 'deleted' && recorded?.data !== true) return 'uncertain'
      if (result === 'deleted' || result === 'refused' || result === 'attention') return result
      return token ? 'uncertain' : 'unavailable'
    }
    finally {
      if (!keepOpen) await browser._call('destroy', undefined, name).catch(() => {})
    }
  })
}
