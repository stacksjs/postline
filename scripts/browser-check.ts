/**
 * Open every workspace view in a real browser and fail on what a person
 * would see break (#80).
 *
 *   bun scripts/browser-check.ts
 *
 * Starts the API and the site on ports of their own against a fresh, migrated
 * database in a temporary directory, creates the workspace account, signs in,
 * and opens each view in headless Chrome three ways: light, dark, and a
 * 375-pixel phone. A view fails on a console error, a failed same-origin
 * request, an stx binding that never evaluated, or a page wider than the
 * screen. A screenshot of every view and mode is written to
 * storage/framework/browser-check/, which CI keeps with the run.
 *
 * Unit tests render nothing; this is what would have caught a Settings window
 * whose bindings all went dead, or an editor that never mounted.
 */
import type { Cdp } from '@stacksjs/testing/browser'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { auditPage, closeSharedBrowsers, launch } from '@stacksjs/testing/browser'

const root = join(import.meta.dir, '..')
const out = join(root, 'storage/framework/browser-check')
const ports = [0, 0].map(() => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() }))
const API_PORT = Number(process.env.BROWSER_CHECK_API_PORT) || ports[0]!.port
const SITE_PORT = Number(process.env.BROWSER_CHECK_PORT) || ports[1]!.port
for (const port of ports) port.stop(true)
const site = `http://localhost:${SITE_PORT}`

/** The workspace views a signed-in owner opens. */
const VIEWS = ['composer', 'queue', 'timeline', 'analytics', 'campaigns', 'listening', 'inbox', 'accounts', 'activity', 'writing', 'settings']

const MODES = [
  { name: 'light', width: 1280, height: 800, mobile: false, scheme: 'light' },
  { name: 'dark', width: 1280, height: 800, mobile: false, scheme: 'dark' },
  { name: 'phone', width: 375, height: 812, mobile: true, scheme: 'light' },
] as const

const work = mkdtempSync(join(tmpdir(), 'postline-browser-check-'))
const database = join(work, 'postline.sqlite')
copyFileSync(join(root, 'app/Desktop/database.template.sqlite'), database)

const env = {
  ...process.env,
  APP_ENV: 'local',
  DB_CONNECTION: 'sqlite',
  DB_DATABASE_PATH: database,
  PORT: String(SITE_PORT),
  PORT_API: String(API_PORT),
  POSTLINE_BLOG_DIR: join(work, 'blog'),
  POSTLINE_MEDIA_DIR: join(work, 'media'),
  MAIL_MAILER: 'log',
  PASSKEY_ORIGIN: site,
}

const servers = [
  Bun.spawn(['./buddy', 'dev:api'], { cwd: root, env, stdout: 'ignore', stderr: 'pipe' }),
  Bun.spawn(['./buddy', 'dev:frontend'], { cwd: root, env, stdout: 'ignore', stderr: 'pipe' }),
]

async function waitUntil(what: string, ready: () => Promise<boolean>, timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await ready().catch(() => false)) return
    await Bun.sleep(500)
  }
  throw new Error(`${what} did not start within ${timeoutMs / 1000}s`)
}

const failures: string[] = []
function fail(view: string, mode: string, problem: string): void {
  failures.push(`${view} (${mode}): ${problem}`)
}

async function evaluate<T>(cdp: Cdp, expression: string): Promise<T> {
  const result = await cdp.send<{ result: { value: T }, exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function pressKey(cdp: Cdp, key: string, keyCode: number, modifiers = 0): Promise<void> {
  const event = { key, code: key, windowsVirtualKeyCode: keyCode, modifiers }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event, text: key === 'Enter' ? '\r' : undefined })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
}

async function checkWorkspaceCommands(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/queue`, { cdp })
  const dialog = "document.getElementById('workspace-commands')"
  const search = `${dialog}.querySelector('input')`
  const option = `${dialog}.querySelector('[role=option][aria-selected=true]')`
  const trigger = "document.querySelector('button[aria-controls=workspace-commands]')"
  const fill = (value: string): Promise<void> => evaluate(cdp, `${search}.value = ${JSON.stringify(value)}; ${search}.dispatchEvent(new Event('input', { bubbles: true }))`)

  await evaluate(cdp, "document.getElementById('queue-search').focus()")
  await pressKey(cdp, '?', 191, 8)
  if (await evaluate<boolean>(cdp, `${dialog}.open`)) fail('queue', 'commands', 'typing a question mark opened the shortcuts over a text field')

  await evaluate(cdp, `${trigger}.focus()`)
  await pressKey(cdp, '?', 191, 8)
  await waitUntil('The shortcut sheet', () => evaluate<boolean>(cdp, `${dialog}.open && ${dialog}.querySelector('h2').textContent === 'Keyboard shortcuts' && ${dialog}.querySelector('dl').innerText.includes('Settings')`), 5_000)
  await pressKey(cdp, 'Escape', 27)
  if (!await evaluate<boolean>(cdp, `!${dialog}.open && document.activeElement === ${trigger}`))
    fail('queue', 'commands', 'Escape did not restore focus after the shortcut sheet')

  await pressKey(cdp, 'k', 75, 2)
  await waitUntil('Search focus in the command palette', () => evaluate<boolean>(cdp, `${dialog}.open && document.activeElement === ${search}`), 5_000)
  await fill('queue view')
  await waitUntil('Both Queue views as command results', () => evaluate<boolean>(cdp, `${option}?.textContent.includes('Go to view') && [...${dialog}.querySelectorAll('[role=option]')].some(item => item.textContent.includes('Calendar'))`), 5_000)
  await pressKey(cdp, 'ArrowDown', 40)
  await pressKey(cdp, 'ArrowDown', 40)
  if (!await evaluate<boolean>(cdp, `${option}?.textContent.includes('Calendar') && ${search}.getAttribute('aria-activedescendant') === ${option}.id`))
    fail('queue', 'commands', 'Arrow Down did not move the accessible selection to Calendar')
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The existing Calendar action', () => evaluate<boolean>(cdp, `!${dialog}.open && Boolean(document.querySelector('[aria-label="Previous month"]')?.getClientRects().length)`), 5_000)

  await pressKey(cdp, 'k', 75, 4)
  await fill('analytics')
  await waitUntil('The Analytics destination', () => evaluate<boolean>(cdp, `${option}?.textContent.includes('Analytics')`), 5_000)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Navigation from the command palette', () => evaluate<boolean>(cdp, `location.pathname === '/analytics' && !!document.querySelector('[data-postline-page=analytics]')`), 5_000)

  await pressKey(cdp, 'k', 75, 2)
  await fill('no-matching-command-42')
  await waitUntil('The palette after client navigation', () => evaluate<boolean>(cdp, `${dialog}.open && ${dialog}.querySelector('[role=status]').innerText === 'No matching commands' && !${option}`), 5_000)
  await pressKey(cdp, 'Escape', 27)
  if (await evaluate<boolean>(cdp, `${dialog}.open`)) fail('analytics', 'commands', 'Escape only cleared the query and left the palette open')
  await evaluate(cdp, `${trigger}.focus()`)
  await pressKey(cdp, '2', 50)
  await waitUntil('The existing Queue number shortcut', () => evaluate<boolean>(cdp, `location.pathname === '/queue' && !!document.querySelector('[data-postline-page=queue]')`), 5_000)

  await pressKey(cdp, 'k', 75, 2)
  await fill('settings')
  await waitUntil('The Settings destination', () => evaluate<boolean>(cdp, `${option}?.textContent.includes('Settings')`), 5_000)
  await pressKey(cdp, 'Enter', 13)
  // Settings has its own layout. Wait for the new document to hydrate in dev.
  await waitUntil('The Settings command trigger to hydrate', () => evaluate<boolean>(cdp, `location.pathname === '/settings' && ${trigger}?.getAttribute('aria-expanded') === 'false'`), 15_000)
  await evaluate(cdp, `${trigger}.click()`)
  await fill('appearance')
  await waitUntil('A command for the Appearance pane', () => evaluate<boolean>(cdp, `${option}?.textContent.trim().startsWith('Appearance')`), 5_000)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The existing Settings pane action', () => evaluate<boolean>(cdp, `!${dialog}.open && document.querySelector('[data-settings-item=appearance]')?.getAttribute('aria-selected') === 'true' && Boolean(document.querySelector('[data-settings-pane=appearance]')?.getClientRects().length)`), 5_000)
}

async function checkQueueKeyboard(cdp: Cdp): Promise<void> {
  await pressKey(cdp, 'Tab', 9)
  const skip = await evaluate<string>(cdp, 'document.activeElement?.getAttribute("href")')
  if (skip !== '#workspace-content') fail('queue', 'keyboard', 'the skip link is not the first tab stop')
  await pressKey(cdp, 'Enter', 13)
  if (await evaluate<string>(cdp, 'document.activeElement?.id') !== 'workspace-content')
    fail('queue', 'keyboard', 'the skip link did not focus the main content')

  await evaluate(cdp, 'document.getElementById("queue-tab-scheduled")?.focus()')
  await pressKey(cdp, 'ArrowRight', 39)
  const selected = await evaluate<boolean>(cdp, `document.activeElement?.id === 'queue-tab-drafts'
    && document.activeElement.getAttribute('aria-selected') === 'true'`)
  if (!selected) fail('queue', 'keyboard', 'Right Arrow did not select and focus the Drafts tab')

  const actions = 'summary[aria-label="More post actions"]'
  await waitUntil('The queue draft', () => evaluate<boolean>(cdp, `Boolean(document.querySelector('${actions}')?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `document.querySelector('${actions}').focus()`)
  await pressKey(cdp, 'Enter', 13)
  if (!await evaluate<boolean>(cdp, `document.querySelector('${actions}').parentElement.open`))
    fail('queue', 'keyboard', 'Enter did not open the actions disclosure')
  await pressKey(cdp, 'Tab', 9)
  if (await evaluate<string>(cdp, 'document.activeElement?.textContent?.trim()') !== 'Edit')
    fail('queue', 'keyboard', 'Tab did not reach Edit in the open actions disclosure')
  await pressKey(cdp, 'Escape', 27)
  if (!await evaluate<boolean>(cdp, `document.activeElement?.matches('${actions}') && !document.activeElement.parentElement.open`))
    fail('queue', 'keyboard', 'Escape did not close the disclosure and return focus')

  await evaluate(cdp, 'document.getElementById("queue-search")?.focus()')
  await cdp.send('Input.insertText', { text: 'keyboard smoke test' })
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The post search result', () => evaluate<boolean>(cdp, `document.querySelector('#queue-results[aria-label="Matching posts"] article')?.textContent.includes('A draft for the keyboard smoke test')`), 5_000)
}

async function checkDesktopUpdateControls(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.craft = { window: {}, capabilities: { nativePlatformControls: false } }
    window.postlineUpdateTestActions = []
    const actualFetch = window.fetch.bind(window)
    window.fetch = async (input, options) => {
      const request = new Request(input, options)
      if (new URL(request.url).pathname !== '/__desktop/update') return actualFetch(input, options)
      const action = request.method === 'POST' ? (await request.json()).action : null
      window.postlineUpdateTestActions.push(action || 'status')
      return Response.json({
        currentVersion: '0.3.0', selfUpdating: true,
        state: action === 'check' ? 'available' : action === 'install' ? 'installed' : 'idle',
        ...(action ? { version: '0.4.0' } : {}),
      })
    }
  ` })
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    await auditPage(`${site}/settings`, { cdp })
    await waitUntil('Settings displays the installed desktop version', () => evaluate<boolean>(cdp, `document.querySelector('[data-setting="desktop-version"]')?.innerText.includes('0.3.0')`), 5_000)
    await evaluate(cdp, `document.querySelector('[data-setting="desktop-version"] button')?.click()`)
    await waitUntil('Settings displays the available desktop update', () => evaluate<boolean>(cdp, `document.querySelector('[data-setting="desktop-install"]')?.innerText.includes('0.4.0')`), 5_000)
    await evaluate(cdp, `document.querySelector('[data-setting="desktop-install"] button')?.click()`)
    await waitUntil('Settings announces the installed update', () => evaluate<boolean>(cdp, `Array.from(document.querySelectorAll('[role="status"]')).some(node => node.textContent.includes('Update installed.'))`), 5_000)
  }
  catch (error) {
    const details = await evaluate<unknown>(cdp, `({
      requests: window.postlineUpdateTestActions,
      version: document.querySelector('[data-setting="desktop-version"]')?.textContent,
      update: document.querySelector('[data-setting="desktop-install"]')?.textContent,
    })`)
    throw new Error(`${String(error)} (${JSON.stringify(details)})`)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

async function checkNetworkComponents(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const actualFetch = window.fetch.bind(window)
    const postedAt = new Date().toISOString()
    let inboxUnread = 3
    const conversations = [
      { id: 1, provider: 'bluesky', participantName: 'Alice Example', participantHandle: 'alice.example', lastMessageAt: postedAt, lastMessagePreview: 'Hello' },
      { id: 2, provider: 'mastodon', participantName: 'Morgan Example', participantHandle: 'morgan.example', lastMessageAt: postedAt, lastMessagePreview: 'Hello' },
    ]
    window.fetch = (input, options) => {
      const request = new Request(input, options)
      const path = new URL(request.url).pathname
      if (path === '/api/postline/bootstrap') return actualFetch(input, options).then(async response => {
        if (!response.ok) return response
        const payload = await response.json()
        return Response.json({ ...payload, data: { ...payload.data, unread: { inbox: inboxUnread, listening: 106 } } })
      })
      if (path === '/api/postline/inbox') return Promise.resolve(Response.json({ ok: true, data: { conversations } }))
      if (path === '/api/postline/inbox/read') inboxUnread = 2
      if (path === '/api/postline/inbox/thread' || path === '/api/postline/inbox/read') return Promise.resolve(Response.json({ ok: true, data: {} }))
      if (path === '/api/postline/bluesky/timeline') return Promise.resolve(Response.json({ ok: true, data: {
        connected: true,
        items: [
          { uri: 'post-1', authorHandle: 'alice.example', authorName: 'Alice Example', postedAt, body: 'First post' },
          { uri: 'post-2', authorHandle: 'morgan.example', authorName: 'Morgan Example', postedAt, body: 'Second post', authorAvatar: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
        ],
      } }))
      return actualFetch(input, options)
    }
  ` })
  try {
    await auditPage(`${site}/inbox`, { cdp })
    await waitUntil('Distinct unread badges on Inbox and Listening', () => evaluate<boolean>(cdp, `
      (() => {
        const inbox = document.querySelector('[data-testid="postline-nav"] a[href="/inbox"]')
        const listening = document.querySelector('[data-testid="postline-nav"] a[href="/listening"]')
        return inbox.textContent.includes('3 unread messages') && inbox.querySelector('kbd').textContent.trim() === '7'
          && listening.textContent.includes('106 unread mentions') && listening.textContent.includes('99+')
      })()`), 5_000)
    await waitUntil('The inbox badges for two networks', () => evaluate<boolean>(cdp, `
      ['Bluesky', 'Mastodon'].every(label => {
        const chip = document.querySelector('button span[role="img"][aria-label="' + label + '"]')
        return chip?.textContent === label.charAt(0) && getComputedStyle(chip).backgroundColor !== 'rgba(0, 0, 0, 0)'
      })`), 5_000)
    await evaluate(cdp, `document.querySelector('button span[role="img"][aria-label="Mastodon"]').closest('button').click()`)
    await waitUntil('The selected network badge in the conversation', () => evaluate<boolean>(cdp, `
      document.querySelector('section[aria-label="Conversation"] header [role="img"][aria-label="Mastodon"]')?.textContent === 'M'`), 5_000)
    await waitUntil('The unread count after reading a conversation', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-testid="postline-nav"] a[href="/inbox"]')?.textContent.includes('2 unread messages')`), 5_000)

    await auditPage(`${site}/timeline`, { cdp })
    await waitUntil('Timeline initials and image from their own rows', () => evaluate<boolean>(cdp, `
      document.querySelector('.postline-feed-post__avatar[aria-label="Alice Example"]')?.textContent.trim() === 'AE'
      && document.querySelector('.postline-feed-post__avatar[aria-label="Morgan Example"] img')?.naturalWidth === 1`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

async function checkWorkspaceBootstrap(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/composer`, { cdp })
  const reads = `performance.getEntriesByType('resource')
    .map(entry => new URL(entry.name).pathname)
    .filter(path => /^\\/api\\/postline\\/(bootstrap|providers|accounts|unread|settings\\/workspace|(bluesky|twitter|mastodon|linkedin|instagram|threads)\\/status)$/.test(path))`
  await waitUntil('The shared workspace bootstrap', () => evaluate<boolean>(cdp, `${reads}.includes('/api/postline/bootstrap')`), 5_000)
  for (const view of ['queue', 'campaigns', 'accounts', 'listening', 'composer']) {
    await evaluate(cdp, `window.stx.navigate('/${view}')`)
    await waitUntil(`Client navigation to ${view}`, () => evaluate<boolean>(cdp, `location.pathname === '/${view}' && !!document.querySelector('[data-postline-page="${view}"]')`), 5_000)
  }
  const requests = await evaluate<string[]>(cdp, reads)
  if (requests.length !== 1 || requests[0] !== '/api/postline/bootstrap')
    fail('workspace', 'bootstrap', `expected one bootstrap request across five views, saw ${requests.join(', ') || 'none'}`)

  await evaluate(cdp, `(() => {
    const settingsWindow = new BroadcastChannel('postline:workspace')
    settingsWindow.postMessage('changed')
    settingsWindow.close()
  })()`)
  await waitUntil('The bootstrap after a change in another window', () => evaluate<boolean>(cdp, `${reads}.length === ${requests.length + 1}`), 5_000)
}

async function checkPhoneNavigation(cdp: Cdp): Promise<void> {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  await auditPage(`${site}/queue`, { cdp })
  await waitUntil('The bottom navigation on a phone', () => evaluate<boolean>(cdp, `
    (() => {
      const nav = document.querySelector('[data-postline-mobile-nav]')
      return nav.getBoundingClientRect().bottom === innerHeight && nav.clientWidth === nav.scrollWidth
        && nav.querySelector('a[href="/queue"]').getAttribute('aria-current') === 'page'
    })()`), 5_000)

  const more = '[aria-controls="workspace-more"]'
  await evaluate(cdp, `document.querySelector('${more}').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The More dialog and its focused Close button', () => evaluate<boolean>(cdp, `
    document.querySelector('#workspace-more').open
      && document.querySelector('${more}').getAttribute('aria-expanded') === 'true'
      && document.activeElement.getAttribute('aria-label') === 'Close menu'`), 5_000)
  await pressKey(cdp, 'Escape', 27)
  await waitUntil('Closing More returns focus', () => evaluate<boolean>(cdp, `
    !document.querySelector('#workspace-more').open
      && document.activeElement.matches('${more}')
      && document.activeElement.getAttribute('aria-expanded') === 'false'`), 5_000)

  await evaluate(cdp, `Array.from(document.querySelectorAll('[data-view-toggle]')).find(button => button.innerText.includes('Agenda')).click()`)
  await waitUntil('The agenda replaces the month grid', () => evaluate<boolean>(cdp, `
    document.querySelector('[aria-label="Monthly agenda"]').getClientRects().length > 0
      && !document.querySelector('[data-cal-cell]')?.getClientRects().length`), 5_000)
  await evaluate(cdp, `document.querySelector('button[aria-label="Next month"]').click()`)
  await waitUntil('All posts scheduled on the same day are available in the agenda', () => evaluate<boolean>(cdp, `
    [...document.querySelectorAll('[aria-label="Monthly agenda"] a')].filter(link => link.textContent.includes('Phone agenda fixture')).length === 4`), 5_000)
  await evaluate(cdp, `Array.from(document.querySelectorAll('[aria-label="Monthly agenda"] a')).find(link => link.textContent.includes('Phone agenda fixture')).scrollIntoView({ block: 'center' })`)
  const agendaScreenshot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, 'queue-agenda-phone.png'), Buffer.from(agendaScreenshot.data, 'base64'))

  await evaluate(cdp, `document.querySelector('${more}').click()`)
  await waitUntil('More reopens before choosing Analytics', () => evaluate<boolean>(cdp, `document.querySelector('#workspace-more').open`), 5_000)
  await evaluate(cdp, `document.querySelector('#workspace-more a[href="/analytics"]').click()`)
  await waitUntil('The Analytics view opens and closes the menu', () => evaluate<boolean>(cdp, `
    location.pathname === '/analytics' && !document.querySelector('#workspace-more').open`), 10_000)
  await waitUntil('The chart has readable phone labels', () => evaluate<boolean>(cdp, `
    (() => {
      const chart = document.querySelector('[data-analytics-chart]')
      const tick = chart?.querySelector('[data-chart-x-axis] text')
      return tick && chart.viewBox.baseVal.width <= 375
        && chart.getScreenCTM().a * Number.parseFloat(getComputedStyle(tick).fontSize) >= 11
    })()`), 5_000)

  await auditPage(`${site}/composer`, { cdp })
  await evaluate(cdp, `document.querySelector('[data-schedule-toggle]').click()`)
  await waitUntil('The composer schedule fits at 375 pixels', () => evaluate<boolean>(cdp, `
    (() => {
      const input = document.querySelector('[data-compose-schedule]')
      const bounds = input.getBoundingClientRect()
      return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth
    })()`), 5_000)
}

let exitCode = 0
try {
  await waitUntil('The API', async () => (await fetch(`http://localhost:${API_PORT}/api/postline/health`)).status < 500)
  await waitUntil('The site', async () => (await fetch(`${site}/login`)).ok)
  mkdirSync(out, { recursive: true })

  const { cdp, close } = await launch({ viewport: { width: 1280, height: 800 } })
  try {
    // The workspace account, created and signed in through the real pages:
    // the CSRF cookie and the session cookie land in this browser context.
    await auditPage(`${site}/login`, { cdp })
    const signedIn = await evaluate<string>(cdp, `(async () => {
      const credentials = ['check@postline.test', 'other@postline.test'].map(email => {
        const fields = new FormData()
        fields.set('name', 'Browser Check')
        fields.set('email', email)
        fields.set('password', 'browser-check-password')
        return fields
      })
      const registrations = await Promise.all(credentials.map(body => fetch('/api/register', { method: 'POST', body })))
      if (registrations.filter(result => result.ok).length !== 1 || !registrations.some(result => result.status === 403))
        return 'expected exactly one workspace owner: ' + registrations.map(result => result.status).join(', ')
      const body = credentials[registrations.findIndex(result => result.ok)]
      const login = await fetch('/api/login', { method: 'POST', body })
      const payload = await login.json()
      if (!payload.token && !payload.access_token) return 'login failed: ' + JSON.stringify(payload)
      document.cookie = 'postline-signed-in=1; path=/'
      await fetch('/api/csrf')
      const draft = await fetch('/api/postline/queue', { method: 'POST', body: new URLSearchParams({ text: 'A draft for the keyboard smoke test', providers: 'bluesky' }) })
      if (!draft.ok) return 'could not create the queue fixture: ' + await draft.text()
      const current = new Date()
      const upcoming = new Date(current.getFullYear(), current.getMonth() + 1, 15, 12).toISOString().slice(0, 19).replace('T', ' ')
      for (let index = 1; index <= 4; index++) {
        const scheduled = await fetch('/api/postline/queue', { method: 'POST', body: new URLSearchParams({ text: 'Phone agenda fixture ' + index, providers: 'bluesky', scheduled_at: upcoming }) })
        if (!scheduled.ok) return 'could not create the agenda fixture: ' + await scheduled.text()
      }
      return 'ok'
    })()`)
    if (signedIn !== 'ok') throw new Error(signedIn)

    for (const mode of MODES) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.mobile })
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode.scheme }] })
      for (const view of VIEWS) {
        const report = await auditPage(`${site}/${view}`, { cdp })
        for (const error of report.errors) fail(view, mode.name, `console: ${error}`)
        for (const request of report.failed) fail(view, mode.name, `request failed: ${request}`)
        if (report.finalUrl && !report.finalUrl.includes(`/${view}`)) fail(view, mode.name, `landed on ${report.finalUrl}`)

        const overflow = await evaluate<number>(cdp, 'document.documentElement.scrollWidth - window.innerWidth')
        if (overflow > 1) fail(view, mode.name, `${overflow}px wider than the screen`)

        const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
        writeFileSync(join(out, `${view}-${mode.name}.png`), Buffer.from(shot.data, 'base64'))
        if (view === 'queue' && mode.name === 'light') await checkQueueKeyboard(cdp)
      }
    }
    await checkDesktopUpdateControls(cdp)
    await checkWorkspaceCommands(cdp)
    await checkWorkspaceBootstrap(cdp)
    await checkNetworkComponents(cdp)
    await checkPhoneNavigation(cdp)
  }
  finally {
    await close()
    await closeSharedBrowsers()
  }
}
catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
  // A server that never came up says why on its own stderr.
  for (const [index, server] of servers.entries()) {
    server.kill()
    const said = (await new Response(server.stderr).text().catch(() => '')).trim().split('\n').slice(-15).join('\n')
    if (said) failures.push(`${index === 0 ? 'API' : 'site'} said:\n${said}`)
  }
}
finally {
  for (const server of servers) server.kill()
  rmSync(work, { recursive: true, force: true })
}

if (failures.length) {
  exitCode = 1
  console.error(`${failures.length} problem(s):\n${failures.map(line => `  ${line}`).join('\n')}`)
}
else {
  // eslint-disable-next-line no-console
  console.log(`Every view opened clean in ${MODES.map(mode => mode.name).join(', ')}. Screenshots in ${out}.`)
}
process.exit(exitCode)
