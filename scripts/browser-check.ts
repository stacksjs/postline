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
  const result = await cdp.send<{
    result: { value: T }
    exceptionDetails?: { text: string, exception?: { description?: string } }
  }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}

async function pressKey(cdp: Cdp, key: string, keyCode: number, modifiers = 0): Promise<void> {
  const event = { key, code: key, windowsVirtualKeyCode: keyCode, modifiers }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event, text: key === 'Enter' ? '\r' : undefined })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
}

interface AccessibleControl {
  ignored: boolean
  role?: { value?: string }
  name?: { value?: string }
  backendDOMNodeId?: number
}

const namedRoles = new Set(['button', 'link', 'checkbox', 'combobox', 'DisclosureTriangle', 'listbox', 'menuitem', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox'])

async function checkAccessibleControls(cdp: Cdp, view: string): Promise<void> {
  const { nodes } = await cdp.send<{ nodes: AccessibleControl[] }>('Accessibility.getFullAXTree')
  for (const node of nodes) {
    const role = node.role?.value
    if (node.ignored || !role || !namedRoles.has(role) || node.name?.value?.trim()) continue
    const { outerHTML } = node.backendDOMNodeId
      ? await cdp.send<{ outerHTML: string }>('DOM.getOuterHTML', { backendNodeId: node.backendDOMNodeId })
      : { outerHTML: '' }
    fail(view, 'accessibility', `unnamed ${role} ${outerHTML.slice(0, 280)}`)
  }
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
  await waitUntil('The existing Calendar action', () => evaluate<boolean>(cdp, `!${dialog}.open && Boolean(document.querySelector('[aria-label="Queue calendar"] [aria-label="Previous month"]')?.getClientRects().length)`), 5_000)

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

async function checkWorkspaceShell(cdp: Cdp): Promise<void> {
  const shell = "document.querySelector('[data-postline-shell]')"
  const collapse = "document.querySelector('[data-sidebar-collapse]')"
  const expand = "document.querySelector('[data-sidebar-expand-fab]')"
  const width = `Math.round(Number.parseFloat(getComputedStyle(${shell}).getPropertyValue('--postline-sidebar-width')))`

  await auditPage(`${site}/queue`, { cdp })
  await waitUntil('Workspace sidebar hydration', () => evaluate<boolean>(cdp, `${shell}?.dataset.sidebarCollapsed === 'false'`), 5_000)
  await evaluate(cdp, `${collapse}.click()`)
  await waitUntil('The browser sidebar is collapsed', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.sidebarCollapsed === 'true' && ${width} === 0
      && getComputedStyle(${expand}).visibility === 'visible'`), 5_000)
  await auditPage(`${site}/queue`, { cdp })
  if (!await evaluate<boolean>(cdp, `${shell}.dataset.sidebarCollapsed === 'true' && ${width} === 0`))
    fail('queue', 'shell', 'a sidebar collapsed before reload was restored expanded')
  await evaluate(cdp, `${expand}.click()`)
  await waitUntil('The expanded sidebar is visible again', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.sidebarCollapsed === 'false' && ${width} === 286
      && getComputedStyle(${expand}).visibility === 'hidden'`), 5_000)

  const offlineNotice = "document.querySelector('[data-stx-toast-key=postline-offline]')"
  await evaluate(cdp, "window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('offline'))")
  await waitUntil('The offline notice is displayed once', () => evaluate<boolean>(cdp, `
    ${offlineNotice}?.getAttribute('role') === 'status'
      && document.querySelectorAll('[data-stx-toast-key=postline-offline]').length === 1
      && ${offlineNotice}.textContent.includes('Scheduled posts still go out on time.')`), 5_000)
  await evaluate(cdp, "window.dispatchEvent(new Event('online'))")
  await waitUntil('The online notice replaces the offline notice', () => evaluate<boolean>(cdp, `
    !${offlineNotice}
      && document.querySelector('#stx-toast-container [data-stx-toast]:not([data-stx-toast-exiting])')?.textContent.includes('Back online')`), 5_000)

  await evaluate(cdp, `(() => {
    const calls = window.postlineShellCalls = {
      collapsed: [], settings: [], drags: 0, focus: 0, appearance: '',
      notifications: [], badge: 0, menu: [], login: false, loginChanges: 0,
    }
    localStorage.setItem('postline:alerts:last-seen', '101')
    const send = window.fetch.bind(window)
    window.fetch = (input, options) => {
      if (new URL(input instanceof Request ? input.url : input, location.href).pathname === '/api/postline/alerts')
        return Promise.resolve(Response.json({ ok: true, data: { unread: 2, alerts: [
          { id: 103, title: 'Already read', body: null, read: true },
          { id: 102, title: 'Scheduled post failed', body: 'Review the queue.', read: false },
          { id: 101, title: 'Already seen', body: null, read: false },
        ] } }))
      return send(input, options)
    }
    window.craft = {
      window: {
        setWebSidebarCollapsed: async value => calls.collapsed.push(value),
        startDrag: async () => { calls.drags++ },
        open: async options => calls.settings.push(options),
        focus: async () => { calls.focus++ },
        setAppearance: async mode => { calls.appearance = mode },
      },
      settings: {
        onOpen: callback => {
          calls.openSettingsFromMenu = callback
          return () => { delete calls.openSettingsFromMenu }
        },
      },
      app: {
        notify: async notification => calls.notifications.push(notification),
        setBadge: async count => { calls.badge = count },
      },
      tray: { setMenu: async items => { calls.menu = items } },
      autoLaunch: {
        isEnabled: async () => calls.login,
        enable: async () => { calls.login = true; calls.loginChanges++; return calls.login },
      },
    }
    window.dispatchEvent(new Event('craft:ready'))
  })()`)
  await waitUntil('The late native bridge is connected', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.shellNative === 'true'
      && getComputedStyle(${collapse}.parentElement).display === 'none'
      && Boolean(window.postlineShellCalls.openSettingsFromMenu)`), 5_000)
  await waitUntil('The dock badge, new notification and tray menu', () => evaluate<boolean>(cdp, `
    (() => {
      const { badge, menu, notifications } = window.postlineShellCalls
      return badge === 2 && notifications.length === 1 && notifications[0].title === 'Scheduled post failed'
        && notifications[0].body === 'Review the queue.'
        && menu.some(item => item.label === 'Pause Publishing' && item.action === 'toggle-publishing')
        && localStorage.getItem('postline:alerts:last-seen') === '103'
    })()`), 5_000)
  const trayAction = (action: string): string => `window.dispatchEvent(new CustomEvent('craft:tray:menuAction', { detail: { action: ${JSON.stringify(action)} } }))`
  await evaluate(cdp, trayAction('toggle-publishing'))
  await waitUntil('Publishing can be paused from the Craft tray', () => evaluate<boolean>(cdp, `
    window.postlineShellCalls.menu.some(item => item.label === 'Resume Publishing')`), 5_000)
  await evaluate(cdp, trayAction('toggle-publishing'))
  await waitUntil('Publishing can be resumed from the Craft tray', () => evaluate<boolean>(cdp, `
    window.postlineShellCalls.menu.some(item => item.label === 'Pause Publishing')`), 5_000)
  await evaluate(cdp, `${collapse}.click()`)
  await waitUntil('The Craft titlebar toggle collapses the sidebar', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.sidebarCollapsed === 'true'
      && window.postlineShellCalls.collapsed.at(-1) === true
      && getComputedStyle(${expand}).visibility === 'hidden'`), 5_000)
  await evaluate(cdp, `${collapse}.click()`)
  await waitUntil('The Craft titlebar toggle expands the sidebar', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.sidebarCollapsed === 'false' && window.postlineShellCalls.collapsed.at(-1) === false`), 5_000)
  await evaluate(cdp, `(() => {
    document.querySelector('[data-postline-workspace]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    ${collapse}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    document.querySelector('a[data-command-destination="Settings"]').click()
    window.postlineShellCalls.openSettingsFromMenu()
  })()`)
  if (!await evaluate<boolean>(cdp, `
    window.postlineShellCalls.drags === 1 && location.pathname === '/queue'
      && window.postlineShellCalls.settings.length === 2
      && window.postlineShellCalls.settings.every(options => options.name === 'settings' && options.url === location.origin + '/settings')`))
    fail('queue', 'shell', 'native dragging or opening Settings through the link and menu failed')

  await evaluate(cdp, `(() => {
    const settings = new BroadcastChannel('postline:settings')
    settings.postMessage({ type: 'theme', pref: 'dark' })
    settings.postMessage({ type: 'navigate', path: '/timeline' })
    settings.close()
  })()`)
  await waitUntil('Settings can move the native workspace to another view', () => evaluate<boolean>(cdp, `
    location.pathname === '/timeline' && !!document.querySelector('[data-postline-page=timeline]')
      && window.postlineShellCalls?.focus === 1 && ${shell}.dataset.shellNative === 'true'
      && window.postlineShellCalls.appearance === 'dark' && document.documentElement.dataset.theme === 'dark'`), 5_000)
  await evaluate(cdp, `(() => {
    const settings = new BroadcastChannel('postline:settings')
    settings.postMessage({ type: 'theme', pref: 'system' })
    settings.close()
  })()`)
  await waitUntil('The system theme is restored', () => evaluate<boolean>(cdp, 'window.postlineShellCalls.appearance === "system"'), 5_000)
  await evaluate(cdp, trayAction('toggle-login'))
  await waitUntil('The tray stays connected across navigation', () => evaluate<boolean>(cdp, `
    window.postlineShellCalls.loginChanges === 1
      && window.postlineShellCalls.menu.some(item => item.action === 'toggle-login' && item.checked === true)`), 5_000)
}

async function checkWorkspaceSkipLink(cdp: Cdp, view: string): Promise<void> {
  await pressKey(cdp, 'Tab', 9)
  const skip = await evaluate<string>(cdp, 'document.activeElement?.getAttribute("href")')
  if (skip !== '#workspace-content') fail(view, 'keyboard', 'the skip link is not the first tab stop')
  await pressKey(cdp, 'Enter', 13)
  if (await evaluate<string>(cdp, 'document.activeElement?.id') !== 'workspace-content')
    fail(view, 'keyboard', 'the skip link did not focus the main content')
}

async function checkQueueKeyboard(cdp: Cdp): Promise<void> {
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

  await evaluate(cdp, `document.querySelector('#queue-results ${actions}').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await pressKey(cdp, 'Tab', 9)
  await pressKey(cdp, 'Tab', 9)
  if (await evaluate<string>(cdp, 'document.activeElement?.textContent?.trim()') !== 'Delete')
    fail('queue', 'keyboard', 'Tab did not reach Delete in the search result')
  await pressKey(cdp, 'Enter', 13)
  const activeDialog = `document.activeElement?.closest('[role=alertdialog]')`
  await waitUntil('The delete confirmation focuses Cancel', () => evaluate<boolean>(cdp, `
    document.activeElement?.textContent === 'Cancel' && ${activeDialog}?.getAttribute('aria-modal') === 'true'
      && document.getElementById(${activeDialog}.getAttribute('aria-labelledby'))?.textContent === 'Delete this post?'`), 5_000)
  await pressKey(cdp, 'Escape', 27)
  await waitUntil('Escaping the confirmation leaves the draft and restores focus', () => evaluate<boolean>(cdp, `
    document.activeElement?.closest('#queue-results article')?.textContent.includes('A draft for the keyboard smoke test')
      && document.activeElement?.textContent.trim() === 'Delete'`), 5_000)
  await pressKey(cdp, 'Enter', 13)
  await pressKey(cdp, 'Tab', 9)
  if (!await evaluate<boolean>(cdp, `${activeDialog} && document.activeElement.textContent === 'Delete post'`))
    fail('queue', 'keyboard', 'Tab did not reach the focused delete confirmation')
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The confirmed draft deletion', () => evaluate<boolean>(cdp, `
    !document.querySelector('#queue-results[aria-label="Matching posts"] article')
      && document.querySelector('#stx-toast-container')?.textContent.includes('Post removed from the queue.')`), 5_000)
  await evaluate(cdp, `document.querySelector('#stx-toast-container button[data-stx-toast-action]').click()`)
  await waitUntil('Undo restores the draft to the search results', () => evaluate<boolean>(cdp, `
    document.querySelector('#queue-results[aria-label="Matching posts"] article')?.textContent.includes('A draft for the keyboard smoke test')
      && document.querySelector('#stx-toast-container')?.textContent.includes('Post restored to the queue.')`), 5_000)
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
  const publishedUrl = 'https://bsky.app/profile/alice.example/post/first'
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const actualFetch = window.fetch.bind(window)
    const postedAt = new Date().toISOString()
    const publishGate = new Promise(resolve => { window.finishPublish = resolve })
    let inboxUnread = 3
    const conversations = [
      { id: 1, provider: 'bluesky', participantName: 'Alice Example', participantHandle: 'alice.example', lastMessageAt: postedAt, lastMessagePreview: 'Hello' },
      { id: 2, provider: 'mastodon', participantName: 'Morgan Example', participantHandle: 'morgan.example', lastMessageAt: postedAt, lastMessagePreview: 'Hello' },
    ]
    const account = { id: 101, provider: 'bluesky', handle: 'alice.example', connected: true, canPublish: true, isDefault: true }
    const instagram = { ...account, id: 102, provider: 'instagram' }
    window.fetch = (input, options) => {
      const request = new Request(input, options)
      const path = new URL(request.url).pathname
      if (path === '/api/postline/bootstrap') return actualFetch(input, options).then(async response => {
        if (!response.ok) return response
        const payload = await response.json()
        const providers = payload.data.providers.map(provider => {
          if (provider.provider === 'bluesky') return { ...provider, ...account, accounts: [account], characterLimit: 300 }
          if (provider.provider === 'instagram') return { ...provider, ...instagram, accounts: [instagram] }
          return provider
        })
        return Response.json({ ...payload, data: { ...payload.data, providers, unread: { inbox: inboxUnread, listening: 106 } } })
      })
      if (path === '/api/postline/publish') return request.formData().then(async body => {
        window.composerPublish = { text: body.get('text'), providers: body.get('providers') }
        await publishGate
        return Response.json({ ok: true, data: { postId: 1, results: [{ provider: 'bluesky', ok: true, url: ${JSON.stringify(publishedUrl)} }] } })
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

    await auditPage(`${site}/composer`, { cdp })
    const target = `document.querySelector('[data-provider-toggle="bluesky:101"]')`
    await waitUntil('The imported Composer connection data', () => evaluate<boolean>(cdp, `Boolean(${target}?.getClientRects().length)`), 5_000)
    const text = '👨‍👩‍👧‍👦'
    await evaluate(cdp, `(() => {
      for (const other of document.querySelectorAll('[data-provider-toggle][aria-pressed=true]')) if (other !== ${target}) other.click()
      if (${target}.getAttribute('aria-pressed') !== 'true') ${target}.click()
      const editor = document.querySelector('[data-bluesky-text]')
      editor.value = ${JSON.stringify(text)}
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      editor.focus()
    })()`)
    await waitUntil('The shared grapheme counter', () => evaluate<boolean>(cdp, "document.querySelector('[data-bluesky-count]').textContent.includes('1 / 300')"), 5_000)
    const variantToggle = "document.querySelector('[data-variant-toggle]')"
    const variant = "document.querySelector('[data-variant-input=bluesky]')"
    await evaluate(cdp, `${variantToggle}.click()`)
    const customize = "document.querySelector('[data-variant-action=fork][data-variant-provider=bluesky]')"
    await waitUntil('Bluesky can customize the shared text', () => evaluate<boolean>(cdp, `Boolean(${customize})`), 5_000)
    await evaluate(cdp, `${customize}.click()`)
    await waitUntil('The Bluesky override copies shared text and takes focus', () => evaluate<boolean>(cdp, `
      ${variant}?.value === ${JSON.stringify(text)} && document.activeElement === ${variant}`), 5_000)
    await evaluate(cdp, `${variant}.value = 'a'.repeat(301)
      ${variant}.dispatchEvent(new Event('input', { bubbles: true }))
      ${variant}.setSelectionRange(2, 2)`)
    await cdp.send('Input.insertText', { text: 'Z' })
    await waitUntil('Typing preserves the override caret and updates the network limit', () => evaluate<boolean>(cdp, `
      ${variant}.selectionStart === 3 && ${variant}.value.startsWith('aaZ')
        && ${target}.getAttribute('data-over') === 'true'
        && document.querySelector('[data-bluesky-count]').textContent.includes('too long for Bluesky')`), 5_000)
    await evaluate(cdp, "document.querySelector('[data-variant-action=reset][data-variant-provider=bluesky]').click()")
    await waitUntil('Resetting the override restores the shared copy and count', () => evaluate<boolean>(cdp, `
      !${variant} && ${target}.getAttribute('data-over') !== 'true'
        && document.querySelector('[data-bluesky-count]').textContent.includes('1 / 300')`), 5_000)
    await evaluate(cdp, `${variantToggle}.click()`)
    const instagram = "document.querySelector('[data-provider-toggle=\"instagram:102\"]')"
    await evaluate(cdp, `(() => {
      ${instagram}.click()
      const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), char => char.charCodeAt(0))
      const clipboardData = new DataTransfer()
      clipboardData.items.add(new File([bytes], 'Pasted.gif', { type: 'image/gif' }))
      document.querySelector('[data-bluesky-text]').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    })()`)
    await waitUntil('Pasted GIF shows an inline warning specific to Instagram', () => evaluate<boolean>(cdp, `
      !!document.querySelector('[data-image-alt]')
        && document.querySelector('[data-image-warnings]').textContent.includes('Instagram takes JPEG')
        && document.querySelector('[data-bluesky-publish]').disabled`), 5_000)
    await evaluate(cdp, `${instagram}.click()`)
    await waitUntil('Deselecting Instagram clears its warning without removing the image', () => evaluate<boolean>(cdp, `
      !!document.querySelector('[data-image-alt]')
        && !document.querySelector('[data-image-warnings]').textContent.trim()
        && !document.querySelector('[data-bluesky-publish]').disabled`), 5_000)
    await evaluate(cdp, `document.querySelector('[aria-label="Remove Pasted.gif"]').click()
      document.querySelector('[data-bluesky-text]').focus()`)
    await pressKey(cdp, 'Enter', 13, 4)
    await waitUntil('The imported publish function', () => evaluate<boolean>(cdp, `
      window.composerPublish?.text === ${JSON.stringify(text)} && window.composerPublish.providers === 'bluesky:101'`), 5_000)
    await waitUntil('The publish progress notice', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-stx-toast-key=publish]:not([data-stx-toast-exiting]) [data-stx-toast-loading]') !== null`), 5_000)
    await evaluate(cdp, 'window.finishPublish()')
    await waitUntil('The publish success notice replaces progress', () => evaluate<boolean>(cdp, `
      !document.querySelector('[data-stx-toast-key=publish]:not([data-stx-toast-exiting])')
        && document.querySelector('#stx-toast-container [data-stx-toast][role=status]:not([data-stx-toast-exiting])')?.textContent.includes('Your post is live on Bluesky.')`), 5_000)
    const action = "[...document.querySelectorAll('#stx-toast-container [data-stx-toast]:not([data-stx-toast-exiting]) button[data-stx-toast-action]')].find(button => button.textContent === 'Copy link')"
    const link = await evaluate<string>(cdp, `document.querySelector('#stx-toast-container a[data-stx-toast-action][target=_blank]')?.href`)
    if (link !== publishedUrl) fail('composer', 'publish', 'the confirmation link did not open the published post')
    const { targetInfo } = await cdp.send<{ targetInfo: { browserContextId?: string } }>('Target.getTargetInfo')
    await cdp.send('Browser.grantPermissions', {
      origin: site, browserContextId: targetInfo.browserContextId, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
    await cdp.send('Page.bringToFront')
    await evaluate(cdp, `${action}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The confirmation’s Copy link action writes the post URL', () => evaluate<boolean>(cdp, `(async () =>
      (await navigator.clipboard.readText()) === ${JSON.stringify(publishedUrl)}
        && document.querySelector('#stx-toast-container').textContent.includes('Link copied to clipboard.'))()`), 5_000)
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

async function checkLocalComposerDraft(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/queue`, { cdp })
  const draftKey = 'postline:composer-draft:v1'
  const original = 'A local draft from before the composer format switch'
  const edited = 'Updated local draft'
  const editor = "document.querySelector('[data-bluesky-text]')"
  const richEditor = "document.querySelector('[data-richtext-host] [contenteditable=true]')"
  await evaluate(cdp, `localStorage.setItem('${draftKey}', JSON.stringify({
    activeIndex: 0, mode: 'draft', posts: [{ text: ${JSON.stringify(original)} }], version: 1,
  }))`)
  try {
    await auditPage(`${site}/composer`, { cdp })
    await waitUntil('Legacy local draft text and intent are restored', () => evaluate<boolean>(cdp, `
      ${editor}?.value === ${JSON.stringify(original)}
        && document.querySelector('[data-bluesky-publish-label]').textContent === 'Save draft'`), 5_000)
    await waitUntil('The long-form editor loads the restored text', () => evaluate<boolean>(cdp, `
      ${richEditor}?.textContent === ${JSON.stringify(original)}`), 5_000)
    await evaluate(cdp, `(() => {
      const editor = ${richEditor}
      editor.focus()
      const range = new Range()
      range.selectNodeContents(editor)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })()`)
    await cdp.send('Input.insertText', { text: edited })
    await waitUntil('Edited local draft is saved in the current format', () => evaluate<boolean>(cdp, `(() => {
      const draft = JSON.parse(localStorage.getItem('${draftKey}') || '{}')
      return draft.posts?.[0]?.text === ${JSON.stringify(edited)} && draft.mode === 'single' && draft.action === 'draft'
    })()`), 5_000)
    await auditPage(`${site}/composer`, { cdp })
    await waitUntil('Updated composer draft survives a reload', () => evaluate<boolean>(cdp, `
      ${editor}?.value === ${JSON.stringify(edited)} && ${richEditor}?.textContent === ${JSON.stringify(edited)}`), 5_000)
  }
  finally {
    await auditPage(`${site}/queue`, { cdp })
    await evaluate(cdp, `localStorage.removeItem('${draftKey}')`)
  }
}

async function checkComposerThreadDraft(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/composer`, { cdp })
  const blog = "document.querySelector('[data-provider-toggle=blog]')"
  const format = "document.querySelector('[data-composer-mode=thread]')"
  const editors = "document.querySelectorAll('[data-bluesky-text]')"
  const segments = ['Keyboard thread draft opening', 'Keyboard thread draft conclusion']
  await waitUntil('The Blog is available in the composer', () => evaluate<boolean>(cdp, `Boolean(${blog}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `(() => {
    for (const chip of document.querySelectorAll('[data-provider-toggle][aria-pressed=true]'))
      if (chip !== ${blog}) chip.click()
    if (${blog}.getAttribute('aria-pressed') !== 'true') ${blog}.click()
    ${format}.focus()
  })()`)
  const rich = "document.querySelector('[data-richtext-host] [contenteditable=true]')"
  await waitUntil('The Blog editor is named and multiline', () => evaluate<boolean>(cdp, `
    ${rich}?.matches('[role=textbox][aria-multiline=true][aria-label="Post body 1"]')`), 5_000)
  await checkAccessibleControls(cdp, 'composer (Blog)')
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Keyboard selection of Thread opens two editors', () => evaluate<boolean>(cdp, `
    ${format}.getAttribute('aria-pressed') === 'true' && ${editors}.length === 2`), 5_000)
  await evaluate(cdp, `(() => {
    const segments = ${JSON.stringify(segments)}
    ${editors}.forEach((editor, index) => {
      editor.value = segments[index]
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    ${editors}[1].focus()
  })()`)
  await evaluate(cdp, "document.querySelector('[data-composer-mode=single]').focus()")
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Single format shows the opening without dropping the second segment', () => evaluate<boolean>(cdp, `
    ${editors}.length === 2
      && [...${editors}].filter(editor => editor.closest('[data-composer-post]').getClientRects().length).length === 1
      && ${editors}[0].value === ${JSON.stringify(segments[0])}`), 5_000)
  await evaluate(cdp, `${format}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Returning to Thread restores the second segment', () => evaluate<boolean>(cdp, `
    ${editors}.length === 2 && ${editors}[1].value === ${JSON.stringify(segments[1])}
      && ${editors}[1].getClientRects().length > 0`), 5_000)
  await evaluate(cdp, `document.querySelector('[aria-label="Remove post 2"]').click()`)
  const undoSegment = "document.querySelector('[data-stx-toast-key=composer-post-removed]:not([data-stx-toast-exiting]) [data-stx-toast-action]')"
  await waitUntil('Removing a thread segment offers Undo', () => evaluate<boolean>(cdp, `
    ${editors}.length === 1 && ${undoSegment}?.textContent === 'Undo'`), 5_000)
  await evaluate(cdp, `${undoSegment}.click()`)
  await waitUntil('Undo restores the removed text in one editor', () => evaluate<boolean>(cdp, `
    ${editors}.length === 2 && ${editors}[1].value === ${JSON.stringify(segments[1])}`), 5_000)
  await evaluate(cdp, `(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='), char => char.charCodeAt(0))
    const transfer = new DataTransfer()
    for (const name of ['First', 'Second', 'Third', 'Fourth'])
      transfer.items.add(new File([bytes], name + '.png', { type: 'image/png' }))
    const dropTarget = document.querySelector('[data-composer-image-drop]')
    dropTarget.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    dropTarget.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })()`)
  const alts = "document.querySelectorAll('[data-image-alt]')"
  await waitUntil('Dropping four images adds four alt-text fields', () => evaluate<boolean>(cdp, `${alts}.length === 4`), 5_000)
  await evaluate(cdp, `(() => {
    ${alts}.forEach((input, index) => {
      input.value = 'Description ' + (index + 1)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    document.querySelector('[aria-label="Move Fourth.png earlier"]').focus()
  })()`)
  await pressKey(cdp, 'Enter', 13)
  const orderedAlts = ['Description 1', 'Description 2', 'Description 4', 'Description 3']
  await waitUntil('Keyboard reordering moves images with their alt text', () => evaluate<boolean>(cdp, `
    JSON.stringify([...${alts}].map(input => input.value)) === ${JSON.stringify(JSON.stringify(orderedAlts))}`), 5_000)
  await evaluate(cdp, `(() => {
    const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), char => char.charCodeAt(0))
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File([bytes], 'Pasted.gif', { type: 'image/gif' }))
    ${editors}[1].dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })()`)
  await waitUntil('Pasting a fifth image explains the limit inline without losing attachments', () => evaluate<boolean>(cdp, `
    ${alts}.length === 4 && document.querySelector('[data-image-warnings]').textContent.includes('up to 4 images')`), 5_000)
  await evaluate(cdp, `${editors}[1].focus()`)
  await pressKey(cdp, 's', 83, 4)
  await waitUntil('Cmd+S saves the thread draft', () => evaluate<boolean>(cdp, `
    document.querySelector('#stx-toast-container')?.textContent.includes('Draft saved to the queue.')
      && [...${editors}].every(editor => editor.value === '')`), 5_000)
  const drafts = await evaluate<Array<{ id: number, status: string, body: string }>>(cdp, `(async () => {
    const { data } = await (await fetch('/api/postline/queue')).json()
    return data.items.filter(item => ${JSON.stringify(segments)}.includes(item.body))
  })()`)
  const draft = drafts.find(item => item.body === segments[1])
  if (!draft || drafts.length !== 2 || drafts.some(item => item.status !== 'draft'))
    throw new Error('The queue did not store both keyboard-saved segments as a draft.')
  const savedAlts = await evaluate<string[]>(cdp, `(async () => {
    const { data } = await (await fetch('/api/postline/queue/item?id=${draft.id}')).json()
    return data.images.map(image => image.altText)
  })()`)
  if (JSON.stringify(savedAlts) !== JSON.stringify(orderedAlts))
    throw new Error('Opening a later thread segment did not return all four images in order with their alt text.')

  try {
    await auditPage(`${site}/composer?edit=${draft.id}`, { cdp })
    await waitUntil('Reopening a queued thread restores every segment in order', () => evaluate<boolean>(cdp, `
      ${format}.getAttribute('aria-pressed') === 'true'
        && JSON.stringify([...${editors}].map(editor => editor.value)) === ${JSON.stringify(JSON.stringify(segments))}
        && document.querySelector('[data-bluesky-publish-label]').textContent === 'Save draft'`), 5_000)
  }
  finally {
    await evaluate(cdp, "localStorage.removeItem('postline:composer-draft:v1')")
  }
}

async function checkChannels(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const send = window.fetch.bind(window)
    const gate = new Promise(resolve => { window.releaseChannels = resolve })
    const status = { provider: 'bluesky', connected: true, canPublish: true, authStatus: 'connected' }
    let accounts = [
      { ...status, id: 101, handle: 'news.example', isDefault: true, expiresSoon: true, expiresAt: new Date(Date.now() + 172800000).toISOString() },
      { ...status, id: 102, handle: 'radio.example', isDefault: false, expiresSoon: false },
    ]
    window.channelReads = []
    window.fetch = async (input, options) => {
      const request = new Request(input, options)
      const path = new URL(request.url).pathname
      if (request.method === 'GET' && (path === '/api/postline/bootstrap' || path === '/api/postline/network-apps' || path.endsWith('/status') && path.startsWith('/api/postline/'))) window.channelReads.push(path)
      if (path === '/api/postline/accounts/default' || path === '/api/postline/accounts/disconnect') {
        const id = Number((await request.formData()).get('id'))
        accounts = path.endsWith('/default') ? accounts.map(account => ({ ...account, isDefault: account.id === id })) : accounts.filter(account => account.id !== id)
        return Response.json({ ok: true })
      }
      if (path !== '/api/postline/bootstrap') return send(input, options)
      await gate
      const response = await send(input, options)
      if (!response.ok) return response
      const payload = await response.json()
      payload.data.accounts = accounts
      payload.data.providers = payload.data.providers.map(provider => provider.provider === 'bluesky'
        ? { ...provider, ...status, handle: accounts.find(account => account.isDefault)?.handle, accounts }
        : provider)
      return Response.json(payload)
    }
  ` })
  try {
    await auditPage(`${site}/accounts`, { cdp })
    await waitUntil('Channels loading without a disconnected flash', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-channels-loading]')?.getClientRects().length > 0
      && !document.querySelector('[data-channel]')`), 5_000)
    await evaluate(cdp, 'window.releaseChannels()')
    const card = "document.querySelector('[data-channel=bluesky]')"
    await waitUntil('The shared channel cards and account health', () => evaluate<boolean>(cdp, `
      document.querySelectorAll('[data-channel]').length === 7
      && ${card}?.innerText.includes('@news.example')
      && ${card}.innerText.includes('Expires in')
      && document.querySelectorAll('[data-network-app]').length === 4`), 5_000)
    const requests = await evaluate<string[]>(cdp, 'window.channelReads')
    if (requests.length !== 1 || requests[0] !== '/api/postline/bootstrap')
      fail('accounts', 'channels', `expected one bootstrap request, saw ${requests.join(', ')}`)

    await evaluate(cdp, `${card}.querySelector('[aria-label="Publish to @radio.example by default"]').click()`)
    await waitUntil('The new default channel account', () => evaluate<boolean>(cdp, `
      [...${card}.querySelectorAll('li')].find(row => row.innerText.includes('@radio.example'))?.innerText.includes('Default')
      && !${card}.querySelector('[aria-label="Publish to @radio.example by default"]').getClientRects().length`), 5_000)

    const disconnect = `${card}.querySelector('[aria-label="Disconnect @news.example"]')`
    await evaluate(cdp, `${disconnect}.focus(); ${disconnect}.click()`)
    await waitUntil('Disconnect confirmation', () => evaluate<boolean>(cdp, `
      ${card}.querySelector('dialog').open && ${card}.querySelector('dialog h3').innerText.includes('@news.example')`), 5_000)
    await pressKey(cdp, 'Escape', 27)
    if (!await evaluate<boolean>(cdp, `!${card}.querySelector('dialog').open && document.activeElement === ${disconnect}`))
      fail('accounts', 'channels', 'closing confirmation did not restore focus')
    await evaluate(cdp, `${disconnect}.click(); ${card}.querySelector('dialog button[type=button]').click()`)
    await waitUntil('The disconnected account is removed from its card', () => evaluate<boolean>(cdp, `
      !${disconnect} && ${card}.innerText.includes('@radio.example') && !${card}.querySelector('dialog').open`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

async function checkBrowserPasskey(cdp: Cdp): Promise<void> {
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send<{ authenticatorId: string }>('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  try {
    const addPasskey = "document.querySelector('[data-setting=passkey-add] button')"
    await auditPage(`${site}/settings`, { cdp })
    await waitUntil('The Account pane', () => evaluate<boolean>(cdp, `Boolean(document.querySelector('[data-settings-item=account]')?.getClientRects().length)`), 5_000)
    await evaluate(cdp, "document.querySelector('[data-settings-item=account]').click()")
    await waitUntil('The Add Passkey button', () => evaluate<boolean>(cdp, `Boolean(${addPasskey}?.getClientRects().length) && !${addPasskey}.disabled`), 5_000)
    await evaluate(cdp, `${addPasskey}.click()`)
    await waitUntil('The new passkey in Settings', () => evaluate<boolean>(cdp, "Boolean(document.querySelector('[data-passkey-row]')?.getClientRects().length)"), 10_000)
    await evaluate(cdp, "document.querySelector('[data-setting=sign-out] button').click()")
    await waitUntil('The passkey sign-in button after signing out', () => evaluate<boolean>(cdp, `
      location.pathname === '/login' && Boolean(document.querySelector('[data-passkey-sign-in]')?.getClientRects().length)`), 15_000)
    await evaluate(cdp, "document.querySelector('[data-passkey-sign-in]').click()")
    await waitUntil('Passkey sign-in returns to the workspace', () => evaluate<boolean>(cdp, `
      location.pathname === '/composer' && !!document.querySelector('[data-postline-page=composer]')`), 15_000)
  }
  finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
    await cdp.send('WebAuthn.disable')
  }
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
  await evaluate(cdp, `document.querySelector('[aria-label="Queue calendar"] button[aria-label="Next month"]').click()`)
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
  const picker = '[data-postline-schedule-picker] [data-date-time-trigger]'
  const actions = '[data-composer-actions]'
  await waitUntil('The composer scheduling picker', () => evaluate<boolean>(cdp, `
    document.querySelector('${picker}')?.getAttribute('aria-expanded') === 'false'`), 5_000)
  const timezone = await evaluate<string>(cdp, `(async () => {
    const response = await fetch('/api/postline/bootstrap')
    return (await response.json()).data.workspace.timezone
  })()`)
  await evaluate(cdp, `document.querySelector('${actions} summary').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await pressKey(cdp, 'Tab', 9)
  await pressKey(cdp, 'Tab', 9)
  await waitUntil('Tab reaches Schedule in the open action menu', () => evaluate<boolean>(cdp, `
    document.querySelector('${actions}').open && document.activeElement === document.querySelector('${picker}')`), 5_000)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The workspace calendar fits at 375 pixels', () => evaluate<boolean>(cdp, `
    (() => {
      const panel = document.querySelector('[data-date-time-panel]')
      const bounds = panel?.getBoundingClientRect()
      return bounds?.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth
        && panel.textContent.includes(${JSON.stringify(timezone)})
    })()`), 5_000)
  await evaluate(cdp, `document.querySelector('[data-date-time-preset=hour]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('In an hour schedules the composer post', () => evaluate<boolean>(cdp, `
    !document.querySelector('[data-date-time-panel]')
      && !document.querySelector('${actions}').open
      && document.querySelector('[data-bluesky-publish-label]')?.textContent?.startsWith('Schedule for ')`), 5_000)

  const blog = "document.querySelector('[data-provider-toggle=blog]')"
  const scheduledBody = 'Keyboard scheduling fixture'
  await waitUntil('The phone composer has a publishing channel', () => evaluate<boolean>(cdp, `Boolean(${blog})`), 5_000)
  await evaluate(cdp, `(() => {
    for (const chip of document.querySelectorAll('[data-provider-toggle][aria-pressed=true]'))
      if (chip !== ${blog}) chip.click()
    if (${blog}.getAttribute('aria-pressed') !== 'true') ${blog}.click()
    const editor = document.querySelector('[data-bluesky-text]')
    editor.value = ${JSON.stringify(scheduledBody)}
    editor.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await pressKey(cdp, 'Enter', 13, 2)
  await waitUntil('Ctrl+Enter saves the chosen publishing time', () => evaluate<boolean>(cdp, `
    document.querySelector('#stx-toast-container')?.textContent.includes('Scheduled. Check the Queue page')`), 5_000)
  const scheduledAt = await evaluate<string | null>(cdp, `(async () => {
    const { data } = await (await fetch('/api/postline/queue')).json()
    return data.items.find(item => item.status === 'scheduled' && item.body === ${JSON.stringify(scheduledBody)})?.scheduledAt || null
  })()`)
  const delay = scheduledAt ? Date.parse(scheduledAt.replace(' ', 'T') + 'Z') - Date.now() : 0
  if (delay < 58 * 60_000 || delay > 60 * 60_000) throw new Error('Keyboard scheduling did not store the one-hour preset.')
}

async function checkQueueRescheduling(cdp: Cdp): Promise<void> {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await auditPage(`${site}/queue`, { cdp })
  const fixtures = await evaluate<Array<{ id: number, scheduledAt: string }>>(cdp, `(async () => {
    const posts = []
    for (let day = 1; day <= 5; day++) {
      const scheduledAt = '2099-02-0' + day + ' 15:00:00'
      const response = await fetch('/api/postline/queue', { method: 'POST', body: new URLSearchParams({
        text: 'Bulk move fixture ' + day,
        providers: 'bluesky',
        scheduled_at: scheduledAt,
      }) })
      if (!response.ok) throw new Error('Could not save a bulk move fixture.')
      posts.push({ id: (await response.json()).data.postId, scheduledAt })
    }
    return posts
  })()`)
  await auditPage(`${site}/queue`, { cdp })
  await evaluate(cdp, `
    [...document.querySelectorAll('[data-view-toggle]')].find(button => button.textContent.trim() === 'List').click()
    document.getElementById('queue-tab-scheduled').click()
  `)
  const select = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Select posts')`
  const checkboxes = `[...document.querySelectorAll('#queue-results input[type=checkbox][aria-label^="Select Bulk move fixture"]')]`
  await waitUntil('Five scheduled posts with the selection control', () => evaluate<boolean>(cdp, `
    ${checkboxes}.length === 5 && ${select}.getClientRects().length > 0`), 5_000)
  await evaluate(cdp, `${select}.click(); ${checkboxes}.forEach(checkbox => checkbox.click())`)
  const move = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Move one week later')`
  await waitUntil('Five posts selected for one move', () => evaluate<boolean>(cdp, `
    ${checkboxes}.every(checkbox => checkbox.checked) && !${move}.disabled
      && [...document.querySelectorAll('[role=status]')].some(status => status.textContent === '5 selected')`), 5_000)
  await evaluate(cdp, `${move}.click()`)
  await waitUntil('The bulk rescheduling success notice', () => evaluate<boolean>(cdp, `
    document.querySelector('#stx-toast-container')?.textContent.includes('Moved 5 posts.')`), 5_000)
  const moved = await evaluate<Array<{ id: number, scheduledAt: string }>>(cdp, `(async () => {
    const response = await fetch('/api/postline/queue?limit=500')
    return (await response.json()).data.items
  })()`)
  if (!fixtures.every(post => {
    const expected = new Date(Date.parse(`${post.scheduledAt.replace(' ', 'T')}Z`) + 7 * 86_400_000)
      .toISOString().slice(0, 19).replace('T', ' ')
    return moved.some(item => item.id === post.id && item.scheduledAt === expected)
  })) fail('queue', 'rescheduling', 'one bulk action did not move all five dates by one week')

  await waitUntil('The moved posts can be selected for removal', () => evaluate<boolean>(cdp, `
    ${checkboxes}.length === 5 && ${checkboxes}.every(checkbox => !checkbox.checked && !checkbox.disabled)`), 5_000)
  await evaluate(cdp, `${checkboxes}.forEach(checkbox => checkbox.click())`)
  await evaluate(cdp, `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Delete selected').click()`)
  const confirm = `[...document.querySelectorAll('[role=alertdialog] button')].find(button => button.textContent === 'Delete posts')`
  await waitUntil('The bulk removal confirms the selected posts', () => evaluate<boolean>(cdp, `
    ${confirm}?.closest('[role=alertdialog]')?.textContent.includes('Delete 5 posts?')`), 5_000)
  await evaluate(cdp, `${confirm}.click()`)
  await waitUntil('The five posts are removed together', () => evaluate<boolean>(cdp, `
    ${checkboxes}.length === 0 && document.querySelector('#stx-toast-container')?.textContent.includes('5 posts removed from the queue.')`), 5_000)
  await auditPage(`${site}/queue`, { cdp })
  const undo = `document.querySelector('#stx-toast-container button[data-stx-toast-action]')`
  await waitUntil('Undo is available again after reload', () => evaluate<boolean>(cdp, `
    ${undo}?.textContent === 'Undo' && ${checkboxes}.length === 0`), 10_000)
  await evaluate(cdp, `${undo}.click()`)
  await waitUntil('Undo restores the whole batch', () => evaluate<boolean>(cdp, `
    ${checkboxes}.length === 5 && document.querySelector('#stx-toast-container')?.textContent.includes('5 posts restored to the queue.')`), 5_000)

  const day = await evaluate<{ key: string, label: string, zone: string }>(cdp, `(async () => {
    const zone = (await (await fetch('/api/postline/bootstrap')).json()).data.workspace.timezone
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const day = new Date(today + 'T00:00:00Z')
    day.setUTCDate(day.getUTCDate() + 7)
    return { key: day.toISOString().slice(0, 10), label: day.toLocaleDateString('en-US', { timeZone: 'UTC' }), zone }
  })()`)
  const dayPicker = '[data-schedule-day-details]'
  const chooseDay = `document.querySelector('${dayPicker} button[aria-label="${day.label}"]')`
  await evaluate(cdp, `${select}.click()
    document.querySelector('input[aria-label^="Select Bulk move fixture 1,"]').click()
    document.querySelector('${dayPicker} summary').click()
  `)
  await waitUntil('The Queue date picker opens the shared Calendar', () => evaluate<boolean>(cdp, `
    document.querySelector('${dayPicker}')?.open
      && document.querySelector('${dayPicker}').textContent.includes(${JSON.stringify(day.zone)})
      && !!document.querySelector('${dayPicker} button[aria-label="Next month"]')`), 5_000)
  await evaluate(cdp, `if (!${chooseDay}) document.querySelector('${dayPicker} button[aria-label="Next month"]').click()`)
  await waitUntil('The chosen workspace day is available', () => evaluate<boolean>(cdp, `Boolean(${chooseDay} && !${chooseDay}.disabled)`), 5_000)
  await evaluate(cdp, `${chooseDay}.click()`)
  const moveToDate = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Move to date')`
  await waitUntil('The selected calendar date is ready to submit', () => evaluate<boolean>(cdp, `
    !document.querySelector('${dayPicker}').open && !${moveToDate}.disabled`), 5_000)
  await evaluate(cdp, `${moveToDate}.click()`)
  await waitUntil('The date move completes', () => evaluate<boolean>(cdp, `document.querySelector('#stx-toast-container')?.textContent.includes('Moved 1 post.')`), 5_000)
  const preservesClock = await evaluate<boolean>(cdp, `(async () => {
    const items = (await (await fetch('/api/postline/queue?limit=500')).json()).data.items
    const post = items.find(item => item.id === ${fixtures[0]!.id})
    const at = new Date(post.scheduledAt.replace(' ', 'T') + 'Z')
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: ${JSON.stringify(day.zone)}, year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const time = instant => instant.toLocaleTimeString('en-GB', { timeZone: ${JSON.stringify(day.zone)} })
    const original = new Date(${JSON.stringify(fixtures[0]!.scheduledAt.replace(' ', 'T') + 'Z')})
    return formatter.format(at) === ${JSON.stringify(day.key)} && time(at) === time(original)
  })()`)
  if (!preservesClock) fail('queue', 'schedule picker', 'moving to a calendar day changed the post’s workspace clock time')
}

async function checkQueueCalendar(cdp: Cdp): Promise<void> {
  const fixture = await evaluate<{ id: number, from: string, to: string }>(cdp, `(async () => {
    const saved = await fetch('/api/postline/settings/workspace', { method: 'POST', body: new URLSearchParams({ timezone: 'UTC' }) })
    if (!saved.ok) throw new Error('Could not use UTC for the calendar check.')
    const start = new Date()
    start.setUTCHours(15, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() + 7 - start.getUTCDay())
    const from = start.toISOString().slice(0, 10)
    const to = new Date(start.getTime() + 2 * 86_400_000).toISOString().slice(0, 10)
    const response = await fetch('/api/postline/queue', { method: 'POST', body: new URLSearchParams({
      text: 'Move this calendar post', providers: 'bluesky', scheduled_at: from + ' 15:00:00',
    }) })
    if (!response.ok) throw new Error('Could not schedule the calendar fixture.')
    return { id: (await response.json()).data.postId, from, to }
  })()`)
  await auditPage(`${site}/queue`, { cdp })
  await evaluate(cdp, `[...document.querySelectorAll('[aria-label="Queue view"] button')].find(button => button.innerText.includes('Calendar')).click()`)
  const week = `[...document.querySelectorAll('[aria-label="Calendar period"] button')].find(button => button.textContent === 'Week')`
  await waitUntil('The Calendar period controls', () => evaluate<boolean>(cdp, `Boolean(${week}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `${week}.click()`)
  await waitUntil('Seven days in the week grid', () => evaluate<boolean>(cdp, `
    ${week}.getAttribute('aria-pressed') === 'true'
      && document.querySelectorAll('[data-calendar-date]').length === 7
      && !!document.querySelector('[aria-label="Next week"]')`), 5_000)
  await evaluate(cdp, `document.querySelector('[aria-label="Next week"]').click()`)

  const source = `[...document.querySelectorAll('[data-calendar-date="${fixture.from}"] a[draggable=true]')].find(link => link.textContent.includes('Move this calendar post'))`
  const target = `document.querySelector('[data-calendar-date="${fixture.to}"]')`
  await waitUntil('The scheduled post in next week’s calendar', () => evaluate<boolean>(cdp, `Boolean(${source}) && Boolean(${target})`), 5_000)
  const accepted = await evaluate<boolean>(cdp, `(() => {
    const post = ${source}
    const day = ${target}
    const dataTransfer = new DataTransfer()
    const options = { dataTransfer, bubbles: true, cancelable: true }
    post.dispatchEvent(new DragEvent('dragstart', options))
    const allowed = !day.dispatchEvent(new DragEvent('dragover', options))
    day.dispatchEvent(new DragEvent('drop', options))
    return allowed
  })()`)
  if (!accepted) fail('queue', 'calendar', 'the calendar did not accept a scheduled post dropped on a future date')
  await waitUntil('The moved post reappears on its new calendar day', () => evaluate<boolean>(cdp, `
    !${source} && ${target}?.textContent.includes('Move this calendar post')`), 10_000)
  const newTime = await evaluate<string>(cdp, `(async () => {
    const response = await fetch('/api/postline/queue?limit=500')
    return (await response.json()).data.items.find(item => item.id === ${fixture.id})?.scheduledAt
  })()`)
  if (newTime !== `${fixture.to} 15:00:00`)
    fail('queue', 'calendar', 'the dropped post lost its scheduled clock time')

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  await waitUntil('The weekly agenda on a phone', () => evaluate<boolean>(cdp, `(() => {
    const agenda = document.querySelector('[aria-label="Weekly agenda"]')
    return agenda?.getClientRects().length && agenda.querySelectorAll('[role=listitem]').length === 7
      && document.documentElement.scrollWidth - innerWidth <= 1
  })()`), 5_000)
}

async function checkEngagementCountLabels(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const actualFetch = window.fetch.bind(window)
    window.fetch = (input, options) => {
      if (new URL(input instanceof Request ? input.url : input, location.href).pathname !== '/api/postline/analytics')
        return actualFetch(input, options)
      return Promise.resolve(Response.json({ ok: true, data: {
        stats: {
          postsThisWeek: 1, postsLastWeek: 0, minSample: 3,
          engagement: {
            likes: 1, replies: 0, reposts: 0, syncedTargets: 1, providers: ['instagram'],
            countsByProvider: [{ provider: 'instagram', measured: 1, likes: 1, replies: 0, views: 12 }],
          },
        },
        channelMix: [{ provider: 'instagram', published: 1, share: 100 }],
      } }))
    }
  ` })
  try {
    await auditPage(`${site}/analytics`, { cdp })
    await waitUntil('Analytics shows measured zero and omits unavailable reposts', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-analytics-engagement]')?.textContent === '1'
        && document.querySelector('[data-analytics-engagement-trend]')?.textContent === '1 like or reaction · 0 replies'
        && document.querySelector('[data-analytics-network-engagement] li')?.textContent.includes('1 like · 0 replies · 12 views')`), 10_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

async function checkCampaignScheduling(cdp: Cdp): Promise<void> {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const fixture = await evaluate<{ campaignId: number, postId: number }>(cdp, `(async () => {
    const write = async (path, body) => {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Could not create the campaign schedule fixture: ' + await response.text())
      return (await response.json()).data
    }
    const day = new Date().toISOString().slice(0, 10)
    const end = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
    const { campaign } = await write('/api/postline/campaigns', {
      name: 'Scheduling fixture campaign', timezone: 'America/New_York', start_date: day, end_date: end,
    })
    const { post } = await write('/api/postline/campaigns/post', {
      campaign_id: campaign.id, title: 'Plan the scheduling fixture', body: 'Keep the campaign clock time.',
      providers: ['blog'], scheduled_at: day + ' 09:00:00',
    })
    return { campaignId: campaign.id, postId: post.id }
  })()`)
  const recommendation = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const send = window.fetch.bind(window)
    window.fetch = (input, options) => {
      if (new URL(input instanceof Request ? input.url : input, location.href).pathname === '/api/postline/analytics')
        return Promise.resolve(Response.json({ ok: true, data: { timezone: 'America/New_York', stats: { bestHour: { hour: 13 } } } }))
      return send(input, options)
    }
  ` })
  try {
    await auditPage(`${site}/campaigns`, { cdp })
    const post = `[...document.querySelectorAll('article[role=button]')].find(item => item.textContent.includes('Plan the scheduling fixture') && item.getClientRects().length > 0)`
    await waitUntil('The planned campaign post', () => evaluate<boolean>(cdp, `Boolean(${post})`), 5_000)
    await evaluate(cdp, `${post}.focus()`)
  await pressKey(cdp, 'Enter', 13)
    const picker = `document.querySelector('[data-postline-schedule-picker] [data-date-time-trigger]')`
    await waitUntil('The campaign scheduling picker is present', () => evaluate<boolean>(cdp, `Boolean(${picker}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${picker}.click()`)
    const suggested = `document.querySelector('[data-date-time-preset=suggested]')`
    await waitUntil('The next best time in the campaign zone', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-date-time-clock]')?.value === '09:00'
        && document.querySelector('[data-date-time-panel]')?.textContent.includes('America/New_York')
        && Boolean(${suggested}?.getClientRects().length) && !${suggested}.disabled`), 5_000)
    await evaluate(cdp, `${suggested}.click()`)
    await evaluate(cdp, `[...document.querySelectorAll('button[type=submit]')].find(button => button.textContent.trim() === 'Save post' && button.getClientRects().length > 0).click()`)
    await waitUntil('The chosen campaign time is saved', () => evaluate<boolean>(cdp, `(async () => {
      const response = await fetch('/api/postline/campaigns?id=${fixture.campaignId}')
      const posts = (await response.json()).data.selected.posts
      return posts.find(post => post.id === ${fixture.postId})?.scheduledAt.endsWith('13:00:00')
    })()`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: recommendation.identifier })
  }
}

async function checkFirstRun(cdp: Cdp): Promise<void> {
  const setup = `document.querySelector('[data-testid="setup-page"]')`
  const input = (name: string): string => `${setup}.querySelector(` + JSON.stringify(`input[name=${name}]`) + ')'
  const type = async (selector: string, value: string): Promise<void> => {
    await evaluate(cdp, `${selector}.focus(); ${selector}.select()`)
    await cdp.send('Input.insertText', { text: value })
  }
  const click = (selector: string): Promise<void> => evaluate(cdp, `${selector}.click()`)
  const heading = (title: string): Promise<void> => waitUntil(title, () => evaluate<boolean>(cdp, `${setup}?.querySelector('h1').textContent === ${JSON.stringify(title)}`), 20_000)

  await auditPage(`${site}/login`, { cdp })
  const setupLink = `document.querySelector('a[href="/setup"]')`
  await waitUntil('Setup is available from sign-in', () => evaluate<boolean>(cdp, `Boolean(${setupLink}?.getClientRects().length)`), 10_000)
  await click(setupLink)
  await heading('Create the owner account')
  await type(input('name'), 'Browser Check')
  await type(input('email'), 'check@postline.test')
  await type(input('password'), 'browser-check-password')
  await type(input('password_confirmation'), 'wrong-confirmation')
  await click(`${setup}.querySelector('button[type=submit]')`)
  await waitUntil('Registration confirms the password before creating an account', () => evaluate<boolean>(cdp, `${setup}.querySelector('[role=alert]').textContent === 'Passwords do not match.'`), 5_000)
  await type(input('password_confirmation'), 'browser-check-password')
  await click(`${setup}.querySelector('button[type=submit]')`)
  await heading('Name your workspace')
  await type(input('workspaceName'), 'Browser Workspace')
  await type(input('timezone'), 'America/New_York')
  await click(`${setup}.querySelector('button[type=submit]')`)
  await heading('Choose a publishing channel')
  const profileSaved = await evaluate<boolean>(cdp, `(async () => {
    const { data } = await (await fetch('/api/postline/settings/workspace')).json()
    return data.workspaceName === 'Browser Workspace' && data.timezone === 'America/New_York'
  })()`)
  if (!profileSaved) throw new Error('Setup did not save the workspace name and time zone.')

  await click(`${setup}.querySelector('a[href="/accounts?setup=1"]')`)
  const resume = `document.querySelector('a[href="/setup?step=channels"]')`
  await waitUntil('Channels links back to setup', () => evaluate<boolean>(cdp, `location.pathname === '/accounts' && ${resume}?.textContent.includes('Continue setup')`), 15_000)
  await click(resume)
  await heading('Choose a publishing channel')
  await waitUntil('The built-in Blog is the first available channel', () => evaluate<boolean>(cdp, `${setup}.querySelector('[data-setup-channel]')?.value === 'blog'`), 5_000)
  const composerLink = `${setup}.querySelector('a[href="/composer?setup=1&target=blog"]')`
  await click(composerLink)
  await waitUntil('Composer preselects the chosen setup channel', () => evaluate<boolean>(cdp, `location.pathname === '/composer'
    && !!document.querySelector('[data-setup-composer]')
    && document.querySelector('[data-provider-toggle=blog]')?.getAttribute('aria-pressed') === 'true'`), 15_000)
  const title = 'Postline first-run browser check'
  await type("document.querySelector('[data-compose-title]')", title)
  const richEditor = "document.querySelector('[data-richtext-host] [contenteditable=true]')"
  const body = 'My first post is ready to publish.'
  try {
    await waitUntil('The Blog editor is ready', () => evaluate<boolean>(cdp, `Boolean(${richEditor}?.getClientRects().length)`), 10_000)
    await evaluate(cdp, `(() => {
      const editor = ${richEditor}
      editor.focus()
      const range = new Range()
      range.selectNodeContents(editor)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })()`)
    await cdp.send('Input.insertText', { text: body })
    await waitUntil('The Blog body is ready to publish', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-bluesky-text]')?.value.includes(${JSON.stringify(body)})
        && !document.querySelector('[data-bluesky-publish]')?.disabled`), 5_000)
    await click("document.querySelector('[data-bluesky-publish]')")
    await heading('Your first post is ready')
    if (!await evaluate<boolean>(cdp, `Number(new URLSearchParams(location.search).get('post')) > 0`))
      throw new Error('Setup did not persist the post ID returned by publishing.')
  }
  catch (error) {
    const state = await evaluate(cdp, `(async () => ({
      page: location.pathname + location.search,
      heading: document.querySelector('h1')?.textContent,
      message: document.querySelector('[role=alert]')?.textContent,
      toast: document.querySelector('#stx-toast-container')?.textContent,
      title: document.querySelector('[data-compose-title]')?.value,
      body: document.querySelector('[data-bluesky-text]')?.value,
      rich: ${richEditor}?.innerHTML,
      active: document.activeElement?.outerHTML.slice(0, 250),
      disabled: document.querySelector('[data-bluesky-publish]')?.disabled,
      items: (await (await fetch('/api/postline/queue')).json()).data?.items,
    }))()`)
    throw new Error(`${String(error)}. Browser state: ${JSON.stringify(state)}`)
  }
  await click(`${setup}.querySelector('a[href="/queue"]')`)
  await waitUntil('The Queue opens after setup', () => evaluate<boolean>(cdp, `location.pathname === '/queue' && !!document.getElementById('queue-tab-published')`), 15_000)
  await click("document.getElementById('queue-tab-published')")
  await waitUntil('The first Blog post is published in the queue', () => evaluate<boolean>(cdp, `
    [...document.querySelectorAll('#queue-results article')].some(row =>
      row.innerText.includes(${JSON.stringify(body)}) && row.querySelector('[data-target-chip][data-state="sent"]')?.textContent.includes('Blog'))`), 5_000)
  await click("document.getElementById('queue-tab-scheduled')")
}

async function checkSetupProviderRetry(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const actualFetch = window.fetch.bind(window)
    window.resumeProviderBootstrap = false
    window.fetch = (input, options) => {
      const request = new Request(input, options)
      if (new URL(request.url).pathname !== '/api/postline/bootstrap') return actualFetch(input, options)
      if (!window.resumeProviderBootstrap) {
        return Promise.resolve(Response.json({ ok: false, error: 'Temporarily unavailable' }, { status: 503 }))
      }
      return actualFetch(input, options).then(async response => {
        const payload = await response.json()
        const providers = payload.data.providers.map(provider => provider.provider !== 'bluesky' ? provider : {
          ...provider, connected: true, canPublish: true,
          accounts: [{ id: 101, provider: 'bluesky', handle: 'second-channel.example', connected: true, canPublish: true, isDefault: true }],
        })
        return Response.json({ ...payload, data: { ...payload.data, providers } })
      })
    }
  ` })
  try {
    await auditPage(`${site}/composer?setup=1&target=blog`, { cdp })
    const retry = "[...document.querySelectorAll('button')].find(button => button.textContent.includes('Try again') && button.getClientRects().length)"
    await waitUntil('The first registration provider read presents Retry', () => evaluate<boolean>(cdp, `Boolean(${retry})`), 5_000)
    await evaluate(cdp, `window.resumeProviderBootstrap = true; ${retry}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Retry preserves the chosen Blog and leaves Bluesky unselected', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-provider-toggle=blog]')?.getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-provider-toggle="bluesky:101"]')?.getAttribute('aria-pressed') === 'false'`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

let exitCode = 0
try {
  await waitUntil('The API', async () => (await fetch(`http://localhost:${API_PORT}/api/postline/health`)).status < 500)
  await waitUntil('The site', async () => (await fetch(`${site}/login`)).ok)
  mkdirSync(out, { recursive: true })

  const { cdp, close } = await launch({ viewport: { width: 1280, height: 800 } })
  try {
    await checkFirstRun(cdp)
    await checkSetupProviderRetry(cdp)
    const fixturesReady = await evaluate<string>(cdp, `(async () => {
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
    if (fixturesReady !== 'ok') throw new Error(fixturesReady)

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
        if (mode.name === 'light') {
          await checkAccessibleControls(cdp, view)
          await checkWorkspaceSkipLink(cdp, view)
          if (view === 'queue') await checkQueueKeyboard(cdp)
        }
      }
    }
    await checkDesktopUpdateControls(cdp)
    await checkWorkspaceShell(cdp)
    await checkWorkspaceCommands(cdp)
    await checkWorkspaceBootstrap(cdp)
    await checkChannels(cdp)
    await checkNetworkComponents(cdp)
    await checkLocalComposerDraft(cdp)
    await checkComposerThreadDraft(cdp)
    await checkBrowserPasskey(cdp)
    await checkPhoneNavigation(cdp)
    await checkQueueRescheduling(cdp)
    await checkQueueCalendar(cdp)
    await checkCampaignScheduling(cdp)
    await checkEngagementCountLabels(cdp)
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
