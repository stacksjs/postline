/**
 * Open every workspace view in a real browser and fail on what a person
 * would see break (#80).
 *
 *   bun scripts/browser-check.ts [--production] [--marketing-screenshots] [--workspace-spanish]
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
import type { OwnedProcess } from '@stacksjs/cli/owned-process'
import type { Cdp } from '@stacksjs/testing/browser'
import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { spawnOwnedProcess } from '@stacksjs/cli/owned-process'
import { auditPage, closeSharedBrowsers, launch } from '@stacksjs/testing/browser'
import { nextPostingSlot } from '../app/Support/Social/posting-slots'
import { wallTimeInZone } from '../app/Support/time'
import { shareComposerPath } from '../resources/functions/composer-share'

const production = process.argv.includes('--production')
const root = join(import.meta.dir, '..')
const out = join(root, 'storage/framework/browser-check')
const productImages = join(root, 'public/images/product')
const marketingScreenshots = process.argv.includes('--marketing-screenshots')
const spanishWorkspace = process.argv.includes('--workspace-spanish')
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

const env = {
  ...process.env,
  APP_ENV: production ? 'production' : 'local',
  APP_URL: site,
  APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
  POSTLINE_SITE: '',
  POSTLINE_WORKSPACE_LOCALE: spanishWorkspace ? 'es' : 'en',
  DB_CONNECTION: 'sqlite',
  DB_DATABASE_PATH: database,
  PORT: String(SITE_PORT),
  PORT_API: String(API_PORT),
  POSTLINE_BLOG_DIR: join(work, 'blog'),
  POSTLINE_MEDIA_DIR: join(work, 'media'),
  MAIL_MAILER: 'log',
  PASSKEY_ORIGIN: site,
}

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
  const openPalette = async (modifier: number): Promise<void> => {
    await waitUntil('The command trigger is ready', () => evaluate<boolean>(cdp, `
      Boolean(${trigger}?.getClientRects().length && ${trigger}.getAttribute('aria-expanded') === 'false')
    `), 5_000)
    await pressKey(cdp, 'k', 75, modifier)
  }
  const typeQuery = async (value: string): Promise<void> => {
    await waitUntil('The command palette is ready for typing', () => evaluate<boolean>(cdp, `
      ${dialog}.open && document.activeElement === ${search} && ${search}.value === ''
    `), 5_000)
    await cdp.send('Input.insertText', { text: value })
  }

  await evaluate(cdp, "document.getElementById('queue-search').focus()")
  await pressKey(cdp, '?', 191, 8)
  if (await evaluate<boolean>(cdp, `${dialog}.open`)) fail('queue', 'commands', 'typing a question mark opened the shortcuts over a text field')

  await evaluate(cdp, `${trigger}.focus()`)
  await pressKey(cdp, '?', 191, 8)
  await waitUntil('The shortcut sheet', () => evaluate<boolean>(cdp, `${dialog}.open && ${dialog}.querySelector('h2').textContent === 'Keyboard shortcuts' && ${dialog}.querySelector('dl').innerText.includes('Settings')`), 5_000)
  await pressKey(cdp, 'Escape', 27)
  if (!await evaluate<boolean>(cdp, `!${dialog}.open && document.activeElement === ${trigger}`))
    fail('queue', 'commands', 'Escape did not restore focus after the shortcut sheet')

  await openPalette(2)
  await typeQuery('queue view')
  await waitUntil('Both Queue views as command results', () => evaluate<boolean>(cdp, `${option}?.textContent.includes('Go to view') && [...${dialog}.querySelectorAll('[role=option]')].some(item => item.textContent.includes('Calendar'))`), 5_000)
  await pressKey(cdp, 'ArrowDown', 40)
  await pressKey(cdp, 'ArrowDown', 40)
  if (!await evaluate<boolean>(cdp, `${option}?.textContent.includes('Calendar') && ${search}.getAttribute('aria-activedescendant') === ${option}.id`))
    fail('queue', 'commands', 'Arrow Down did not move the accessible selection to Calendar')
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The existing Calendar action', () => evaluate<boolean>(cdp, `!${dialog}.open && Boolean(document.querySelector('[aria-label="Queue calendar"] [aria-label="Previous month"]')?.getClientRects().length)`), 5_000)

  await openPalette(4)
  await typeQuery('analytics')
  await waitUntil('The Analytics destination', () => evaluate<boolean>(cdp, `${option}?.textContent.includes('Analytics')`), 5_000)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Navigation from the command palette', () => evaluate<boolean>(cdp, `location.pathname === '/analytics' && !!document.querySelector('[data-postline-page=analytics]')`), 5_000)

  await openPalette(2)
  await typeQuery('no-matching-command-42')
  await waitUntil('The palette after client navigation', () => evaluate<boolean>(cdp, `${dialog}.open && ${dialog}.querySelector('[role=status]').innerText === 'No matching commands' && !${option}`), 5_000)
  await pressKey(cdp, 'Escape', 27)
  if (await evaluate<boolean>(cdp, `${dialog}.open`)) fail('analytics', 'commands', 'Escape only cleared the query and left the palette open')
  await evaluate(cdp, `${trigger}.focus()`)
  await pressKey(cdp, '2', 50)
  await waitUntil('The existing Queue number shortcut', () => evaluate<boolean>(cdp, `
    location.pathname === '/queue' && !!document.querySelector('[data-postline-page=queue]')
      && ${trigger}?.getAttribute('aria-expanded') === 'false'
  `), 5_000)

  await openPalette(2)
  await typeQuery('settings')
  await waitUntil('The Settings destination', () => evaluate<boolean>(cdp, `${option}?.textContent.includes('Settings') && ${option}.textContent.includes('Go to view')`), 5_000)
  await pressKey(cdp, 'Enter', 13)
  // Settings has its own document, including a new copy of the palette.
  try {
    await waitUntil('The Settings document and command palette', () => evaluate<boolean>(cdp, `
      location.pathname === '/settings'
        && new URL(performance.getEntriesByType('navigation')[0].name).pathname === '/settings'
        && !document.querySelector('[data-postline-shell]')
        && document.querySelectorAll('#workspace-commands').length === 1
        && ${trigger}?.getAttribute('aria-expanded') === 'false'
    `), 15_000)
  }
  catch (error) {
    const state = await evaluate<unknown>(cdp, `({
      path: location.pathname, title: document.title,
      loadedDocument: new URL(performance.getEntriesByType('navigation')[0].name).pathname,
      shell: Boolean(document.querySelector('[data-postline-shell]')),
      settings: Boolean(document.querySelector('[data-postline-page=settings]')),
      expanded: ${trigger}?.getAttribute('aria-expanded'),
    })`)
    throw new Error(`${String(error)} (${JSON.stringify(state)})`)
  }
  await evaluate(cdp, `${trigger}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await typeQuery('appearance')
  await waitUntil('A command for the Appearance pane', () => evaluate<boolean>(cdp, `${option}?.textContent.trim().startsWith('Appearance')`), 5_000)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The existing Settings pane action', () => evaluate<boolean>(cdp, `!${dialog}.open && document.querySelector('[data-settings-item=appearance]')?.getAttribute('aria-selected') === 'true' && Boolean(document.querySelector('[data-settings-pane=appearance]')?.getClientRects().length)`), 5_000)
}

async function checkWorkspaceShell(cdp: Cdp): Promise<void> {
  const shell = "document.querySelector('[data-postline-shell]')"
  const toggle = "document.querySelector('[data-sidebar-collapse]')"
  const back = "document.querySelector('[data-workspace-back]')"
  const forward = "document.querySelector('[data-workspace-forward]')"
  const location = "document.querySelector('[data-workspace-location]')"
  const sidebar = "document.getElementById('workspace-sidebar')"
  const workspace = "document.querySelector('[data-postline-workspace]')"
  const toolbar = "document.querySelector('[data-workspace-toolbar]')"
  const width = `Math.round(Number.parseFloat(getComputedStyle(${shell}).getPropertyValue('--postline-sidebar-width')))`

  await auditPage(`${site}/queue`, { cdp })
  await waitUntil('Workspace sidebar hydration', () => evaluate<boolean>(cdp, `${shell}?.dataset.sidebarCollapsed === 'false'`), 5_000)
  if (!await evaluate<boolean>(cdp, `
    ${width} === 214 && ${workspace}.getBoundingClientRect().top === 8
      && getComputedStyle(${workspace}).borderRadius === '14px'
      && getComputedStyle(document.getElementById('workspace-content')).overflowY === 'auto'
      && ${location}.innerText.includes('Queue')`))
    fail('queue', 'shell', 'the desktop toolbar or inset workspace was not rendered')
  await evaluate(cdp, `${toggle}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The browser sidebar is collapsed', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.sidebarCollapsed === 'true' && ${width} === 0
      && getComputedStyle(${sidebar}).visibility === 'hidden'
      && ${toggle}.getAttribute('aria-expanded') === 'false'
      && document.activeElement === ${toggle}`), 5_000)
  await auditPage(`${site}/queue`, { cdp })
  if (!await evaluate<boolean>(cdp, `${shell}.dataset.sidebarCollapsed === 'true' && ${width} === 0`))
    fail('queue', 'shell', 'a sidebar collapsed before reload was restored expanded')
  await evaluate(cdp, `${toggle}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The expanded sidebar is visible again', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.sidebarCollapsed === 'false' && ${width} === 214
      && getComputedStyle(${sidebar}).visibility === 'visible'
      && ${toggle}.getAttribute('aria-expanded') === 'true'
      && document.activeElement === ${toggle}`), 5_000)

  const profile = "document.querySelector('[data-workspace-profile]')"
  await evaluate(cdp, `${profile}.querySelector('summary').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The workspace account menu opens from the keyboard', () => evaluate<boolean>(cdp, `${profile}.open`), 5_000)
  await evaluate(cdp, `${profile}.querySelector('a[href="/accounts"]').click()`)
  await waitUntil('The account menu opens Channels and updates the toolbar', () => evaluate<boolean>(cdp, `
    window.location.pathname === '/accounts' && !${profile}.open && !${back}.disabled
      && ${forward}.disabled && ${location}.innerText.includes('Channels')
      && ${sidebar}.querySelector('[href="/accounts"]').getAttribute('aria-current') === 'page'`), 5_000)
  await evaluate(cdp, `${back}.click()`)
  await waitUntil('Toolbar Back returns to the queue', () => evaluate<boolean>(cdp, `
    window.location.pathname === '/queue' && ${back}.disabled && !${forward}.disabled
      && ${location}.innerText.includes('Queue')`), 5_000)
  await evaluate(cdp, `${forward}.click()`)
  await waitUntil('Toolbar Forward returns to Channels', () => evaluate<boolean>(cdp, `
    window.location.pathname === '/accounts' && !${back}.disabled && ${forward}.disabled
      && ${location}.innerText.includes('Channels')`), 5_000)
  await evaluate(cdp, `${back}.click()`)
  await waitUntil('The queue is ready for the desktop checks', () => evaluate<boolean>(cdp, `
    window.location.pathname === '/queue' && ${location}.innerText.includes('Queue')`), 5_000)

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
      collapsed: [], settings: [], focus: 0, appearance: '',
      notifications: [], badge: 0, menu: [], login: false, loginChanges: 0,
      deadlines: [], alertQueued: false,
    }
    localStorage.setItem('postline:alerts:last-seen', '101')
    const send = window.fetch.bind(window)
    window.fetch = (input, options) => {
      if (new URL(input instanceof Request ? input.url : input, location.href).pathname === '/api/postline/alerts')
        return Promise.resolve(Response.json({ ok: true, data: { unread: calls.alertQueued ? 3 : 2, alerts: [
          ...(calls.alertQueued ? [{ id: 104, title: 'New scheduled failure', body: null, read: false }] : []),
          { id: 103, title: 'Already read', body: null, read: true },
          { id: 102, title: 'Scheduled post failed', body: 'Review the queue.', read: false },
          { id: 101, title: 'Already seen', body: null, read: false },
        ] } }))
      return send(input, options)
    }
    window.craft = {
      window: {
        setWebSidebarCollapsed: async value => calls.collapsed.push(value),
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
        setBadge: async count => { calls.badge = count },
      },
      notifications: {
        getPermissionStatus: async () => 'authorized',
        show: async notification => calls.notifications.push(notification),
      },
      timers: {
        sleep(delay, { signal }) {
          calls.deadlines.push(delay)
          return new Promise((resolve, reject) => {
            calls.deliverDeadline = resolve
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        },
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
      && ${toggle}.getClientRects().length > 0
      && window.postlineShellCalls.collapsed.at(-1) === false
      && Boolean(window.postlineShellCalls.openSettingsFromMenu)`), 5_000)
  await waitUntil('The dock badge, new notification and tray menu', () => evaluate<boolean>(cdp, `
    (() => {
      const { badge, menu, notifications } = window.postlineShellCalls
      return badge === 2 && notifications.length === 1 && notifications[0].title === 'Scheduled post failed'
        && notifications[0].id === 'postline-alert-102' && notifications[0].body === 'Review the queue.'
        && menu.some(item => item.label === 'Pause Publishing' && item.action === 'toggle-publishing')
        && localStorage.getItem('postline:alerts:last-seen') === '103'
    })()`), 5_000)
  await waitUntil('The next alert poll is scheduled through Craft', () => evaluate<boolean>(cdp, `
    window.postlineShellCalls.deadlines.length === 1 && window.postlineShellCalls.deadlines[0] === 60000`), 5_000)
  await evaluate(cdp, `(() => {
    const calls = window.postlineShellCalls
    calls.alertQueued = true
    calls.deliverDeadline()
  })()`)
  await waitUntil('A native deadline delivers fresh alerts and updates the dock badge', () => evaluate<boolean>(cdp, `
    (() => {
      const { badge, deadlines, notifications } = window.postlineShellCalls
      return badge === 3 && notifications.length === 2 && notifications[1].title === 'New scheduled failure'
        && notifications[1].id === 'postline-alert-104'
        && deadlines.length === 2 && localStorage.getItem('postline:alerts:last-seen') === '104'
    })()`), 5_000)
  const trayAction = (action: string): string => `window.dispatchEvent(new CustomEvent('craft:tray:menuAction', { detail: { action: ${JSON.stringify(action)} } }))`
  await evaluate(cdp, trayAction('toggle-publishing'))
  await waitUntil('Publishing can be paused from the Craft tray', () => evaluate<boolean>(cdp, `
    window.postlineShellCalls.menu.some(item => item.label === 'Resume Publishing')`), 5_000)
  await evaluate(cdp, trayAction('toggle-publishing'))
  await waitUntil('Publishing can be resumed from the Craft tray', () => evaluate<boolean>(cdp, `
    window.postlineShellCalls.menu.some(item => item.label === 'Pause Publishing')`), 5_000)
  await evaluate(cdp, `${toggle}.click()`)
  await waitUntil('The toolbar collapses the Craft sidebar', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.sidebarCollapsed === 'true'
      && window.postlineShellCalls.collapsed.at(-1) === true
      && ${toggle}.getBoundingClientRect().left >= 84`), 5_000)
  await evaluate(cdp, `${toggle}.click()`)
  await waitUntil('The toolbar expands the Craft sidebar', () => evaluate<boolean>(cdp, `
    ${shell}.dataset.sidebarCollapsed === 'false' && window.postlineShellCalls.collapsed.at(-1) === false`), 5_000)
  if (!await evaluate<boolean>(cdp, `
    ${toolbar}.hasAttribute('data-craft-drag')
      && ${sidebar}.hasAttribute('data-craft-drag')
      && ${toggle}.hasAttribute('data-craft-no-drag')
      && document.querySelector('a[data-command-destination="Settings"]').hasAttribute('data-craft-no-drag')`))
    fail('queue', 'shell', 'Craft drag regions or interactive exclusions are missing')

  await evaluate(cdp, `(() => {
    document.querySelector('a[data-command-destination="Settings"]').click()
    window.postlineShellCalls.openSettingsFromMenu()
  })()`)
  if (!await evaluate<boolean>(cdp, `
    location.pathname === '/queue'
      && window.postlineShellCalls.settings.length === 2
      && window.postlineShellCalls.settings.every(options => options.name === 'settings' && options.url === location.origin + '/settings')`))
    fail('queue', 'shell', 'opening native Settings through the link and menu failed')

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
  if (await evaluate<string>(cdp, 'document.activeElement?.textContent?.trim()') !== 'Repeat…')
    fail('queue', 'keyboard', 'Tab did not reach Repeat in the search result')
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

async function checkNotificationSettings(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/settings`, { cdp })
  const item = "document.querySelector('[data-settings-item=notifications]')"
  await waitUntil('The Notifications pane', () => evaluate<boolean>(cdp, `Boolean(${item}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `${item}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  const alerts = await evaluate<{ email: boolean, webhook: boolean }>(cdp, `(async () => {
    const response = await fetch('/api/postline/system')
    const payload = await response.json()
    return payload.data.alerts
  })()`)
  await waitUntil('Notification delivery settings reflect the server configuration', () => evaluate<boolean>(cdp, `
    (() => {
      const email = document.getElementById('settings-row-email-alerts-description')
      const webhook = document.getElementById('settings-row-alert-webhook-description')
      return Boolean(email?.getClientRects().length && email.innerText === ${JSON.stringify(alerts.email ? 'On' : 'Off')}
        && webhook?.getClientRects().length && webhook.innerText === ${JSON.stringify(alerts.webhook ? 'Set up' : 'Not set up')})
    })()
  `), 5_000)
  await evaluate(cdp, "document.querySelector('[data-setting=activity-alerts] button').focus()")
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Notification Settings opens Activity', () => evaluate<boolean>(cdp, `
    location.pathname === '/activity'
      && new URL(performance.getEntriesByType('navigation')[0].name).pathname === '/activity'
      && Boolean(document.querySelector('[data-postline-shell] [data-postline-page=activity]'))
  `), 5_000)
}

async function checkDesktopUpdateControls(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    let permission = 'notDetermined'
    window.nativeNotificationRequests = 0
    window.craft = {
      window: {},
      capabilities: { nativePlatformControls: false },
      notifications: {
        getPermissionStatus: async () => permission,
        requestPermission: async () => {
          window.nativeNotificationRequests++
          permission = 'authorized'
          return true
        },
      },
    }
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
    const report = await auditPage(`${site}/settings`, { cdp })
    for (const error of report.errors) fail('settings', 'desktop controls', error)
    for (const request of report.failed) fail('settings', 'desktop controls', request)
    const about = "document.querySelector('[data-settings-item=about]')"
    await waitUntil('The About pane', () => evaluate<boolean>(cdp, `Boolean(${about}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${about}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Settings displays the installed desktop version', () => evaluate<boolean>(cdp, `
      (() => {
        const version = document.querySelector('[data-setting="desktop-version"]')
        return Boolean(version?.getClientRects().length && version.innerText.includes('0.3.0'))
      })()
    `), 5_000)
    await evaluate(cdp, `document.querySelector('[data-setting="desktop-version"] button')?.click()`)
    await waitUntil('Settings displays the available desktop update', () => evaluate<boolean>(cdp, `document.querySelector('[data-setting="desktop-install"]')?.innerText.includes('0.4.0')`), 5_000)
    await evaluate(cdp, `document.querySelector('[data-setting="desktop-install"] button')?.click()`)
    await waitUntil('Settings announces the installed update', () => evaluate<boolean>(cdp, `Array.from(document.querySelectorAll('[role="status"]')).some(node => node.textContent.includes('Update installed.'))`), 5_000)

    const item = "document.querySelector('[data-settings-item=notifications]')"
    await waitUntil('Native Notifications pane', () => evaluate<boolean>(cdp, `Boolean(${item}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${item}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const allow = "document.querySelector('[data-setting=macos-notifications] button')"
    const description = "document.getElementById('settings-row-macos-notifications-description')"
    await waitUntil('macOS notification permission is offered without prompting', () => evaluate<boolean>(cdp, `
      Boolean(${allow}?.getClientRects().length)
        && ${allow}.textContent.trim() === 'Allow notifications…'
        && window.nativeNotificationRequests === 0
    `), 5_000)
    await evaluate(cdp, `${allow}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Allow notifications requests permission once and shows the result', () => evaluate<boolean>(cdp, `
      !${allow}?.getClientRects().length && ${description}?.innerText === 'On' && window.nativeNotificationRequests === 1
    `), 5_000)
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
        window.composerPublish = { text: body.get('text'), providers: body.get('providers'), language: body.get('language') }
        await publishGate
        return Response.json({ ok: true, data: { postId: 1, results: [{ provider: 'bluesky', ok: true, url: ${JSON.stringify(publishedUrl)} }] } })
      })
      if (path === '/api/postline/bluesky/link-preview') return Promise.resolve(Response.json({
        ok: true, data: { url: 'https://example.com/article', title: 'A preview article', description: 'Article summary' },
      }))
      if (path === '/api/postline/inbox') return Promise.resolve(Response.json({ ok: true, data: { conversations } }))
      if (path === '/api/postline/inbox/read') inboxUnread = 2
      if (path === '/api/postline/inbox/thread' || path === '/api/postline/inbox/read') return Promise.resolve(Response.json({ ok: true, data: {} }))
      if (path === '/api/postline/bluesky/timeline') return Promise.resolve(Response.json({ ok: true, data: {
        connected: true,
        items: [
          { uri: 'post-1', authorHandle: 'alice.example', authorName: 'Alice Example', postedAt, body: 'First post <draft> https://example.com/read?value=one&track=two' },
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
      document.querySelector('[data-timeline-avatar][aria-label="Alice Example"]')?.textContent.trim() === 'AE'
      && document.querySelector('[data-timeline-avatar][aria-label="Morgan Example"] img')?.naturalWidth === 1`), 5_000)

    await waitUntil('Timeline preserves plain post text and renders the link as a labelled anchor', () => evaluate<boolean>(cdp, `(() => {
      const copy = document.querySelector('[data-timeline-copy]')
      const link = copy?.querySelector('a')
      return copy?.textContent === 'First post <draft> https://example.com/read?value=one&track=two'
        && !copy.querySelector('draft') && link?.href === 'https://example.com/read?value=one&track=two'
        && link.rel.includes('noopener') && getComputedStyle(link).color !== getComputedStyle(copy).color
    })()`), 5_000)

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
    const language = "document.querySelector('[data-post-language]')"
    await waitUntil('The selected network loads its language choices', () => evaluate<boolean>(cdp, `
      Boolean(${language}?.querySelector('option[value="de"]')?.textContent)`), 5_000)
    await evaluate(cdp, `
      ${language}.value = 'de'
      ${language}.dispatchEvent(new Event('change', { bubbles: true }))`)
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
        && document.querySelector('[data-bluesky-count]').textContent.includes('too long for Bluesky')
        && document.querySelector('[data-network-preview=bluesky] [data-preview-overflow]')?.textContent === 'Over the limit by 2 characters'
        && document.querySelector('[data-network-preview=bluesky] [data-preview-copy]')?.textContent === 'aaZ' + 'a'.repeat(297) + '…'`), 5_000)
    await evaluate(cdp, "document.querySelector('[data-variant-action=reset][data-variant-provider=bluesky]').click()")
    await waitUntil('Resetting the override restores the shared copy and count', () => evaluate<boolean>(cdp, `
      !${variant} && ${target}.getAttribute('data-over') !== 'true'
        && document.querySelector('[data-bluesky-count]').textContent.includes('1 / 300')`), 5_000)
    await evaluate(cdp, `${variantToggle}.click()`)
    const instagram = "document.querySelector('[data-provider-toggle=\"instagram:102\"]')"
    const linkCard = "document.querySelector('[data-network-preview=bluesky] [data-link-preview]')"
    const editor = "document.querySelector('[data-bluesky-text]')"
    await evaluate(cdp, `${editor}.value = 'Read https://example.com/article'; ${editor}.dispatchEvent(new Event('input', { bubbles: true }))`)
    await waitUntil('Typing a link updates the Bluesky card without a Preview button', () => evaluate<boolean>(cdp, `
      ${linkCard}?.textContent.includes('A preview article') && !document.querySelector('[data-preview-post]')`), 5_000)
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
        && document.querySelector('[data-network-preview=instagram] [data-preview-copy]')?.textContent === 'Read https://example.com/article'
        && document.querySelector('[data-network-preview=instagram] [data-preview-images] img')?.naturalWidth === 1
        && !${linkCard}
        && document.querySelector('[data-bluesky-publish]').disabled`), 5_000)
    await evaluate(cdp, `${instagram}.click()`)
    await waitUntil('Deselecting Instagram clears its warning without removing the image', () => evaluate<boolean>(cdp, `
      !!document.querySelector('[data-image-alt]')
        && !document.querySelector('[data-image-warnings]').textContent.trim()
        && !document.querySelector('[data-network-preview=instagram]')
        && !document.querySelector('[data-bluesky-publish]').disabled`), 5_000)
    await evaluate(cdp, `document.querySelector('[aria-label="Remove Pasted.gif"]').click()
      ${editor}.value = ${JSON.stringify(text)}
      ${editor}.dispatchEvent(new Event('input', { bubbles: true }))
      ${editor}.focus()`)
    await pressKey(cdp, 'Enter', 13, 4)
    await waitUntil('The imported publish function', () => evaluate<boolean>(cdp, `
      window.composerPublish?.text === ${JSON.stringify(text)} && window.composerPublish.providers === 'bluesky:101'
        && window.composerPublish.language === 'de'`), 5_000)
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
  const original = 'A **local draft** from before the format switch.\n\n- [Guide](/docs/first-run)\n- `code`'
  const addition = ' Updated on reopen.'
  const editor = "document.querySelector('[data-bluesky-text]')"
  const richEditor = "document.querySelector('[data-richtext-host] [contenteditable=true]')"
  const formatted = `${richEditor}?.querySelector('strong')?.textContent === 'local draft'
    && ${richEditor}?.querySelector('ul a')?.getAttribute('href') === '/docs/first-run'
    && ${richEditor}?.querySelector('ul code')?.textContent === 'code'`
  await evaluate(cdp, `localStorage.setItem('${draftKey}', JSON.stringify({
    activeIndex: 0, mode: 'draft', posts: [{ text: ${JSON.stringify(original)} }], version: 1,
  }))`)
  try {
    await auditPage(`${site}/composer`, { cdp })
    await waitUntil('Legacy local draft text and intent are restored', () => evaluate<boolean>(cdp, `
      ${editor}?.value === ${JSON.stringify(original)}
        && document.querySelector('[data-bluesky-publish-label]').textContent === 'Save draft'`), 5_000)
    await waitUntil('The long-form editor restores bold, links, lists and code', () => evaluate<boolean>(cdp, formatted), 5_000)
    await evaluate(cdp, `(() => {
      const editor = ${richEditor}
      editor.focus()
      const range = new Range()
      range.selectNodeContents(editor.querySelector('p'))
      range.collapse(false)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })()`)
    await cdp.send('Input.insertText', { text: addition })
    await waitUntil('Edited local draft is saved in the current format', () => evaluate<boolean>(cdp, `(() => {
      const draft = JSON.parse(localStorage.getItem('${draftKey}') || '{}')
      const saved = draft.posts?.[0]?.text || ''
      return saved.includes('**local draft**') && saved.includes(${JSON.stringify(addition)})
        && saved.includes('[Guide](/docs/first-run)') && draft.mode === 'single' && draft.action === 'draft'
    })()`), 5_000)
    await auditPage(`${site}/composer`, { cdp })
    await waitUntil('Updated draft keeps its formatting after reload', () => evaluate<boolean>(cdp, `
      ${formatted} && ${richEditor}.querySelector('p').textContent.includes(${JSON.stringify(addition.trim())})`), 5_000)
  }
  finally {
    await auditPage(`${site}/queue`, { cdp })
    await evaluate(cdp, `localStorage.removeItem('${draftKey}')`)
  }
}

async function checkBrowserShare(cdp: Cdp): Promise<void> {
  const shared = 'https://example.invalid/article?q=red+blue#section'
  const draft = 'A draft written before sharing.'
  const draftKey = 'postline:composer-draft:v1'
  const share = `document.querySelector('[data-stx-toast-key="browser-share"]:not([data-stx-toast-exiting])')`
  const editor = `document.querySelector('[data-bluesky-text]')`
  const path = shareComposerPath(shared)

  await auditPage(`${site}/queue`, { cdp })
  await evaluate(cdp, `localStorage.setItem(${JSON.stringify(draftKey)}, JSON.stringify({
    activeIndex: 0, mode: 'single', action: 'draft', posts: [{ text: ${JSON.stringify(draft)} }],
  }))`)
  try {
    await cdp.send('Network.clearBrowserCookies')
    await auditPage(`${site}${path}`, { cdp })
    await waitUntil('Browser share carries the private fragment into sign-in', () => evaluate<boolean>(cdp, `
      location.pathname === '/login' && location.hash === ${JSON.stringify(new URL(path, site).hash)}
        && document.querySelector('[data-testid=login-page]')?.textContent.includes('add the shared link')`), 5000)
    await evaluate(cdp, `document.querySelector('[name=email]').focus()`)
    await cdp.send('Input.insertText', { text: 'check@postline.test' })
    await evaluate(cdp, `document.querySelector('[name=password]').focus()`)
    await cdp.send('Input.insertText', { text: 'browser-check-password' })
    await pressKey(cdp, 'Enter', 13)

    await waitUntil('Signing in offers the link and preserves the existing draft', () => evaluate<boolean>(cdp, `
      location.pathname === '/composer' && Boolean(${share}?.getClientRects().length)
        && ${share}?.textContent.includes(${JSON.stringify(shared)}) && ${editor}?.value === ${JSON.stringify(draft)}`), 10000)
    await evaluate(cdp, `${share}.querySelector('[data-stx-toast-action]').focus()`)
    await pressKey(cdp, 'Enter', 13)
    const combined = `${draft}\n\n${shared}`
    await waitUntil('Adding the link appends it once and clears the handoff', () => evaluate<boolean>(cdp, `
      location.hash === '' && !${share}?.getClientRects().length && ${editor}?.value === ${JSON.stringify(combined)}`), 5000)

    await auditPage(`${site}${path}`, { cdp })
    await waitUntil('A signed-in workspace can also review the link', () => evaluate<boolean>(cdp, `
      Boolean(${share}?.getClientRects().length) && ${editor}?.value === ${JSON.stringify(combined)}`), 5000)
    await evaluate(cdp, `${share}.querySelector('[aria-label="Dismiss notification"]').click()`)
    await waitUntil('Dismissing a share keeps the draft as it was', () => evaluate<boolean>(cdp, `
      location.hash === '' && !${share}?.getClientRects().length && ${editor}?.value === ${JSON.stringify(combined)}`), 5000)
  }
  finally {
    await auditPage(`${site}/queue`, { cdp })
    await evaluate(cdp, `localStorage.removeItem(${JSON.stringify(draftKey)})`)
  }
}

async function checkComposerPreferences(cdp: Cdp): Promise<void> {
  const editor = `document.querySelector('[data-bluesky-text]')`
  const tab = `document.querySelector('[data-settings-item=composer]')`
  const format = `document.querySelector('[data-setting=default-mode] select')`
  const autosave = `document.querySelector('[data-setting=auto-save] button[role=switch]')`
  const thread = `document.querySelector('[data-stx-segmented-control][aria-label="Post format"] [aria-label=Thread]')`
  const editorRequested = `performance.getEntriesByType('resource').some(entry => new URL(entry.name).pathname.includes('/richtext-editor'))`
  try {
    await auditPage(`${site}/settings`, { cdp })
    await evaluate(cdp, `localStorage.removeItem('postline:composer-draft:v1'); ${tab}.click()`)
    await waitUntil('Settings exposes the Composer format and autosave controls', () => evaluate<boolean>(cdp, `
      ${format}?.getClientRects().length > 0 && ${format}.value === 'single'
        && ${autosave}?.getAttribute('aria-checked') === 'true'
        && document.getElementById(${format}.getAttribute('aria-labelledby'))?.textContent === 'Default mode'
        && document.getElementById(${autosave}.getAttribute('aria-labelledby'))?.textContent === 'Auto-save drafts'`), 5_000)
    await evaluate(cdp, `
      ${format}.value = 'thread'
      ${format}.dispatchEvent(new Event('change', { bubbles: true }))
      ${autosave}.focus()
    `)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Settings disables local draft autosave', () => evaluate<boolean>(cdp, `
      ${autosave}.getAttribute('aria-checked') === 'false'`), 5_000)

    await auditPage(`${site}/composer`, { cdp })
    await waitUntil('A new Composer opens in the default Thread format', () => evaluate<boolean>(cdp, `
      ${thread}?.getAttribute('aria-pressed') === 'true' && Boolean(${editor})`), 5_000)
    await evaluate(cdp, `${editor}.focus()`)
    await cdp.send('Input.insertText', { text: 'A draft with autosave disabled' })
    await waitUntil('Composer receives the text', () => evaluate<boolean>(cdp, `
      ${editor}.value === 'A draft with autosave disabled'`), 5_000)
    await auditPage(`${site}/composer`, { cdp })
    await waitUntil('A fresh Composer opens without an autosaved draft', () => evaluate<boolean>(cdp, `
      ${thread}?.getAttribute('aria-pressed') === 'true' && ${editor}?.value === ''`), 5_000)
    if (await evaluate<boolean>(cdp, editorRequested)) fail('composer', 'Thread', 'downloaded the Blog editor before it was needed')
    await evaluate(cdp, `(() => {
      const blog = document.querySelector('[data-provider-toggle=blog]')
      if (blog.getAttribute('aria-pressed') !== 'true') blog.click()
      document.querySelector('[data-stx-segmented-control][aria-label="Post format"] [aria-label=Single]').click()
    })()`)
    await waitUntil('Switching from Thread to Blog loads the long-form editor', () => evaluate<boolean>(cdp, `
      ${editorRequested} && Boolean(document.querySelector('[data-richtext-host] [contenteditable=true]'))`), 5_000)
  }
  finally {
    await auditPage(`${site}/settings`, { cdp })
    await evaluate(cdp, `
      localStorage.removeItem('postline:composer-format')
      localStorage.removeItem('postline:composer-autosave')
      localStorage.removeItem('postline:composer-draft:v1')
    `)
  }
}

async function checkSavedComposerText(cdp: Cdp): Promise<void> {
  const trigger = "document.querySelector('[data-composer-saved-text]')"
  const library = "document.querySelector('[data-saved-text-library]')"
  const field = (name: string) => `${library}.querySelector('[name=${name}]')`
  const select = `${library}.querySelector('[data-saved-text-select]')`
  const editor = "document.querySelector('[data-bluesky-text]')"
  const button = (name: string) => `${library}.querySelector('[data-saved-text-${name}]')`
  const click = (name: string) => evaluate(cdp, `${button(name)}.click()`)

  await auditPage(`${site}/composer`, { cdp })
  await evaluate(cdp, `${trigger}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The saved Composer text dialog opens', () => evaluate<boolean>(cdp, `${library}.open && !${button('new')}.disabled`), 5_000)
  await click('new')
  await waitUntil('Creating saved text focuses its name', () => evaluate<boolean>(cdp, `document.activeElement === ${field('name')}`), 5_000)
  await evaluate(cdp, `(() => {
    const fill = (field, value) => { field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })) }
    fill(${field('kind')}, 'hashtags')
    fill(${field('name')}, 'Build tags')
    fill(${field('body')}, '#Postline, OpenSource')
    ${library}.querySelector('[data-saved-text-form]').requestSubmit()
  })()`)
  await waitUntil('The saved hashtag set is selected', () => evaluate<boolean>(cdp, `
    ${select}.selectedOptions[0]?.textContent === 'Build tags · Hashtag set'
      && ${library}.textContent.includes('#Postline #OpenSource') && !${button('insert')}.disabled`), 5_000)

  await auditPage(`${site}/composer`, { cdp })
  await evaluate(cdp, `${editor}.value = 'Update copy'; ${editor}.dispatchEvent(new Event('input', { bubbles: true }))`)
  await evaluate(cdp, `${trigger}.click()`)
  await waitUntil('Saved text is available after a reload', () => evaluate<boolean>(cdp, `${select}.selectedOptions[0]?.textContent === 'Build tags · Hashtag set'`), 5_000)
  await click('insert')
  await waitUntil('Inserting saved text returns focus to the post', () => evaluate<boolean>(cdp, `
    !${library}.open && ${editor}.value === 'Update copy\\n#Postline #OpenSource'
      && (document.activeElement === ${editor} || Boolean(document.activeElement?.closest('[data-richtext-host]')))`), 5_000)

  await evaluate(cdp, `${trigger}.click()`)
  await waitUntil('The saved text can be removed independently', () => evaluate<boolean>(cdp, `!${button('delete')}.disabled`), 5_000)
  await click('delete')
  await click('confirm-delete')
  await waitUntil('Deleting saved text preserves the post copy', () => evaluate<boolean>(cdp, `
    !${select}.options.length && ${editor}.value.endsWith('#Postline #OpenSource')`), 5_000)
  await pressKey(cdp, 'Escape', 27)
  await evaluate(cdp, `localStorage.removeItem('postline:composer-draft:v1')`)
}

async function checkFirstComments(cdp: Cdp): Promise<void> {
  const subject = 'First comment browser fixture'
  const body = 'Add the reading list after this post goes live.'
  const fixture = new Database(database)
  const identity = fixture.query(`
    INSERT INTO social_identities (uuid, provider, handle, external_id, auth_status, access_token)
    VALUES (?, 'linkedin', 'Comment fixture', 'urn:li:organization:8542', 'connected', 'browser-fixture-token')
    RETURNING id
  `).get(crypto.randomUUID()) as { id: number }
  const provider = `document.querySelector('[data-provider-toggle="linkedin:${identity.id}"]')`
  const details = "document.querySelector('[data-first-comments]')"
  const field = `${details}.querySelector('textarea')`
  const draft = "JSON.parse(localStorage.getItem('postline:composer-draft:v1') || '{}')"
  let fixturePost = 0
  try {
    await auditPage(`${site}/composer`, { cdp })
    await waitUntil('Composer offers the connected LinkedIn Page', () => evaluate<boolean>(cdp, `Boolean(${provider})`), 5_000)
    if (!await evaluate<boolean>(cdp, `${provider}.getAttribute('aria-pressed') === 'true'`))
      await evaluate(cdp, `${provider}.click()`)
    await evaluate(cdp, `${details}.querySelector('summary').focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('First comments can be opened with the keyboard', () => evaluate<boolean>(cdp, `${field}.getClientRects().length > 0`), 5_000)
    await checkAccessibleControls(cdp, 'composer (first comments)')
    await evaluate(cdp, `${field}.focus()`)
    await cdp.send('Input.insertText', { text: body })
    await waitUntil('The local draft preserves a comment', () => evaluate<boolean>(cdp, `${draft}.firstComments?.linkedin === ${JSON.stringify(body)}`), 5_000)

    await auditPage(`${site}/composer`, { cdp })
    await waitUntil('Composer reloads the first comment', () => evaluate<boolean>(cdp, `${field}?.value === ${JSON.stringify(body)}`), 5_000)
    const created = await evaluate<{ data?: { postId: number } }>(cdp, `fetch('/api/postline/queue', {
      method: 'POST', body: new URLSearchParams({
        text: ${JSON.stringify(subject)}, providers: 'linkedin:${identity.id}', linkedin_first_comment: ${JSON.stringify(body)},
      }),
    }).then(response => response.json())`)
    fixturePost = created.data?.postId || 0
    if (!fixturePost) throw new Error('Could not save the first-comment draft.')
    await auditPage(`${site}/composer?edit=${fixturePost}`, { cdp })
    await waitUntil('Editing a queued draft restores its comment', () => evaluate<boolean>(cdp, `${field}?.value === ${JSON.stringify(body)}`), 5_000)

    fixture.query("UPDATE posts SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE id = ?").run(fixturePost)
    fixture.query(`
      UPDATE post_targets SET status = 'published', social_identity_id = NULL, remote_uri = 'urn:li:share:988',
        remote_url = 'https://www.linkedin.com/feed/update/urn:li:share:988/',
        first_comment_body = ?, first_comment_status = 'failed', first_comment_error = 'Comment permission was refused.'
      WHERE post_id = ?
    `).run(body, fixturePost)
    await auditPage(`${site}/queue`, { cdp })
    await evaluate(cdp, `
      [...document.querySelectorAll('[aria-label="Queue view"] button')].find(button => button.textContent.trim() === 'List').click()
      document.getElementById('queue-tab-attention').click()
    `)
    const row = `[...document.querySelectorAll('#queue-results article')].find(row => row.textContent.includes(${JSON.stringify(subject)}))`
    const retry = `(${row})?.querySelector('button')`
    await waitUntil('Queue shows a failed comment on the published post', () => evaluate<boolean>(cdp, `
      (${row})?.textContent.includes('Comment permission was refused.')
        && (${row})?.textContent.includes('Published')
        && ${retry}?.getClientRects().length > 0
        && ${retry}.textContent.trim() === 'Retry first comment'
        && !(${row})?.innerText.includes('Retry failed networks')`), 5_000)
    await evaluate(cdp, `${retry}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('First comment retry requests the original publishing account', () => evaluate<boolean>(cdp, `
      (${row})?.textContent.includes('The published post or its account could not be found.')`), 5_000)
  }
  finally {
    if (fixturePost) {
      fixture.query('DELETE FROM post_targets WHERE post_id = ?').run(fixturePost)
      fixture.query('DELETE FROM posts WHERE id = ?').run(fixturePost)
    }
    fixture.query('DELETE FROM social_identities WHERE id = ?').run(identity.id)
    fixture.close()
    await evaluate(cdp, "localStorage.removeItem('postline:composer-draft:v1')")
  }
}

async function checkComposerThreadDraft(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/composer`, { cdp })
  const blog = "document.querySelector('[data-provider-toggle=blog]')"
  const format = "document.querySelector('[data-stx-segmented-control] button[aria-label=Thread]')"
  const editors = "document.querySelectorAll('[data-bluesky-text]')"
  const segments = ['Keyboard thread draft opening\n\nAn **emphasized** note.', 'Keyboard thread draft conclusion']
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
  await waitUntil('Blog previews both thread segments as individual posts and formats Markdown', () => evaluate<boolean>(cdp, `
    document.querySelectorAll('[data-network-preview=blog] [data-preview-segment]').length === 2
      && document.querySelector('[data-network-preview=blog] [data-preview-copy] strong')?.textContent === 'emphasized'
      && document.querySelector('[data-network-preview=blog] [data-preview-segment]:nth-of-type(2)')?.textContent.includes('Post 2')`), 5_000)
  await evaluate(cdp, "document.querySelector('[data-stx-segmented-control] button[aria-label=Single]').focus()")
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
    JSON.stringify([...${alts}].map(input => input.value)) === ${JSON.stringify(JSON.stringify(orderedAlts))}
      && JSON.stringify([...document.querySelectorAll('[data-network-preview=blog] [data-preview-images] img')].map(image => image.alt))
        === ${JSON.stringify(JSON.stringify(orderedAlts))}`), 5_000)
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
        && document.querySelector('[data-network-preview=blog] [data-preview-images] img')?.naturalWidth === 1
        && document.querySelector('[data-bluesky-publish-label]').textContent === 'Save draft'`), 5_000)
  }
  finally {
    await evaluate(cdp, "localStorage.removeItem('postline:composer-draft:v1')")
  }
}

async function checkComposerNetworkOptions(cdp: Cdp): Promise<void> {
  const fixture = new Database(database)
  try {
    const identity = fixture.query(`INSERT INTO social_identities
      (uuid, provider, handle, external_id, auth_status, access_token)
      VALUES (?, ?, ?, ?, 'connected', ?)`)
    identity.run(crypto.randomUUID(), 'mastodon', 'options-test', 'https://mastodon.social', 'fixture-token')
    identity.run(crypto.randomUUID(), 'bluesky', 'options-test.example', 'did:plc:options-test', 'fixture-token')
  }
  finally {
    fixture.close()
  }

  const text = 'Browser fixture with a poll and quote'
  const choices = ['Sunrise', 'Sunset'].join('\n')
  const quote = 'https://bsky.app/profile/example.test/post/3j2'
  await evaluate(cdp, "localStorage.removeItem('postline:composer-draft:v1')")
  await auditPage(`${site}/composer`, { cdp })
  const field = (name: string) => `document.querySelector('form [name=${name}]')`
  const target = (provider: string) => `document.querySelector('[data-provider-toggle^="${provider}:"]')`
  await waitUntil('Composer shows both network accounts', () => evaluate<boolean>(cdp,
    `Boolean(${target('mastodon')}?.getClientRects().length && ${target('bluesky')}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `(() => {
    for (const chip of [${target('mastodon')}, ${target('bluesky')}])
      if (chip.getAttribute('aria-pressed') !== 'true') chip.click()
  })()`)
  await waitUntil('Composer shows the selected Mastodon and Bluesky options', () => evaluate<boolean>(cdp, `
    ${target('mastodon')}?.getAttribute('aria-pressed') === 'true'
      && ${target('bluesky')}?.getAttribute('aria-pressed') === 'true'
      && Boolean(${field('pollChoices')} && ${field('blueskyQuote')})`), 5_000)
  await evaluate(cdp, `(() => {
    ${field('pollChoices')}.closest('details').open = true
    ${field('blueskyQuote')}.closest('details').open = true
    const editor = document.querySelector('[data-bluesky-text]')
    editor.value = ${JSON.stringify(text)}
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    ${field('pollChoices')}.value = ${JSON.stringify(choices)}
    ${field('pollMultiple')}.checked = true
    ${field('blueskyQuote')}.value = ${JSON.stringify(quote)}
    ${field('blueskyLabels')}.value = 'graphic-media'
    editor.focus()
  })()`)
  await pressKey(cdp, 's', 83, 4)
  let id: number | undefined
  await waitUntil('Composer saves the network options draft to Queue', async () => {
    id = await evaluate<number | undefined>(cdp, `(async () => {
      const { data } = await (await fetch('/api/postline/queue')).json()
      return data.items.find(item => item.status === 'draft' && item.body === ${JSON.stringify(text)})?.id
    })()`)
    return typeof id === 'number'
  }, 5_000)

  await auditPage(`${site}/composer?edit=${id}`, { cdp })
  await waitUntil('Opening a queued draft restores its poll, labels and quote', () => evaluate<boolean>(cdp, `
    ${field('pollChoices')}?.value === ${JSON.stringify(choices)}
      && ${field('pollMultiple')}?.checked
      && ${field('blueskyQuote')}?.value === ${JSON.stringify(quote)}
      && ${field('blueskyLabels')}?.value === 'graphic-media'`), 5_000)
}

async function checkComposerVideo(cdp: Cdp): Promise<void> {
  const clip = readFileSync(join(root, 'tests/fixtures/postline-video.mp4')).toString('base64')
  const text = 'Browser fixture with a private MP4'
  const bluesky = "document.querySelector('[data-provider-toggle^=\"bluesky:\"]')"
  const video = "document.querySelector('video[data-attached-video]')"
  await evaluate(cdp, "localStorage.removeItem('postline:composer-draft:v1')")
  await auditPage(`${site}/composer`, { cdp })
  await waitUntil('Composer loads the Bluesky video target', () => evaluate<boolean>(cdp,
    `Boolean(${bluesky}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `(() => {
    const selected = ${bluesky}
    for (const chip of document.querySelectorAll('[data-provider-toggle][aria-pressed="true"]'))
      if (chip !== selected) chip.click()
    if (selected.getAttribute('aria-pressed') !== 'true') selected.click()
    const transfer = new DataTransfer()
    const bytes = Uint8Array.from(atob('${clip}'), char => char.charCodeAt(0))
    transfer.items.add(new File([bytes], 'test.mp4', { type: 'video/mp4' }))
    const input = document.querySelector('[data-attach-input]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitUntil('Composer plays the selected MP4', () => evaluate<boolean>(cdp,
    `${video}?.videoWidth === 32`), 5_000)
  await evaluate(cdp, `(() => {
    const alt = document.querySelector('[data-image-alt][aria-label="Video alt text"]')
    alt.value = 'A blue rectangle'
    alt.dispatchEvent(new Event('input', { bubbles: true }))
    const editor = document.querySelector('[data-bluesky-text]')
    editor.value = ${JSON.stringify(text)}
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    editor.focus()
  })()`)
  await pressKey(cdp, 's', 83, 4)
  await waitUntil('Composer clears the video draft after saving', () => evaluate<boolean>(cdp,
    `document.querySelector('[data-bluesky-text]')?.value === '' && !${video}?.getClientRects().length`), 5_000)
  const id = await evaluate<number>(cdp, `(async () => {
    const { data } = await (await fetch('/api/postline/queue')).json()
    return data.items.find(item => item.body === ${JSON.stringify(text)} && item.hasVideo)?.id
  })()`)
  if (!id) throw new Error('Composer did not save a video attachment.')
  try {
    await auditPage(`${site}/composer?edit=${id}`, { cdp })
    await waitUntil('The saved video plays with its original description', () => evaluate<boolean>(cdp,
      `${video}?.videoWidth === 32 && ${video}.getAttribute('aria-label') === 'A blue rectangle'`), 5_000)
  }
  finally {
    await evaluate(cdp, "localStorage.removeItem('postline:composer-draft:v1')")
  }
}

async function checkWorkspaceErasure(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const send = window.fetch.bind(window)
    const profile = 'postline-x-12345678-1234-5678-9012-123456789012'
    window.erasureSteps = []
    const profileWindows = new Map([[profile, 'session'], [profile + '-composer', 'composer']])
    window.allowProfileErasure = false
    window.allowWorkspaceErasure = false
    window.craft = { app: { nativePlatformControls: false }, capabilities: { nativePlatformControls: false }, window: {
      async _call(action, input, name) {
        const windowKind = profileWindows.get(name)
        if (!windowKind) throw Object.assign(new Error('The named X window is absent.'), { code: 'INVALID_PARAMETER' })
        if (action !== 'getState' && action !== 'destroy') throw new Error('Unexpected profile action')
        window.erasureSteps.push(action + '-' + windowKind)
        if (action === 'destroy') profileWindows.delete(name)
      },
      async removeDataStore(name) {
        if (name !== profile) throw new Error('Wrong data store')
        window.erasureSteps.push('remove')
        if (profileWindows.size || !window.allowProfileErasure)
          throw Object.assign(new Error('WebKit still holds this profile.'), { code: 'BUSY' })
      },
    } }
    window.fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href)
      if (url.pathname === '/api/postline/system') {
        const result = await send(input, options).then(response => response.json())
        result.data.localTwitterProfile = profile
        return Response.json(result)
      }
      if (url.pathname === '/api/postline/settings/delete-everything') {
        window.erasureSteps.push('workspace')
        if (options.body.get('removedTwitterProfile') !== profile || options.body.get('confirmation') !== 'DELETE EVERYTHING')
          return Response.json({ ok: false, error: 'Incorrect erasure receipt' }, { status: 409 })
        if (!window.allowWorkspaceErasure)
          return Response.json({ ok: false, error: 'The workspace reset can be retried.' }, { status: 503 })
        return Response.json({ ok: true, data: { deleted: {} } })
      }
      return send(input, options)
    }
  ` })
  const phrase = "document.querySelector('[data-delete-phrase] input')"
  const button = "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Delete Everything')"
  const confirm = "[...document.querySelectorAll('[role=alertdialog] button')].find(button => button.textContent.trim() === 'Delete everything')"
  const perform = async (): Promise<void> => {
    await waitUntil('The previous workspace erasure dialog is gone', () => evaluate<boolean>(cdp, "!document.querySelector('[role=alertdialog]')"), 5_000)
    await evaluate(cdp, `${button}.click()`)
    await waitUntil('Workspace erasure confirmation', () => evaluate<boolean>(cdp, `Boolean(${confirm}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${confirm}.click()`)
  }
  const typeConfirmation = async (): Promise<void> => {
    await auditPage(`${site}/settings`, { cdp })
    await evaluate(cdp, "document.querySelector('[data-settings-item=data]').click()")
    await waitUntil('The workspace erasure input is visible', () => evaluate<boolean>(cdp, `Boolean(${phrase}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${phrase}.focus()`)
    await cdp.send('Input.insertText', { text: 'DELETE EVERYTHING' })
    await waitUntil('Typed workspace erasure phrase', () => evaluate<boolean>(cdp, `!${button}.disabled`), 5_000)
  }
  try {
    await typeConfirmation()
    await perform()
    await waitUntil('Profile erasure errors are shown without clearing the workspace', () => evaluate<boolean>(cdp, `
      document.body.innerText.includes('Close any other window using this X profile, then try again.')
        && window.erasureSteps.join(',') === 'remove,getState-session,destroy-session,getState-composer,destroy-composer,remove'`), 5_000)
    await evaluate(cdp, 'window.allowProfileErasure = true')
    await perform()
    await waitUntil('An unsuccessful workspace reset reports a retry after profile removal', () => evaluate<boolean>(cdp, `
      document.body.innerText.includes('The workspace reset can be retried.')
        && window.erasureSteps.join(',') === 'remove,getState-session,destroy-session,getState-composer,destroy-composer,remove,remove,workspace'`), 5_000)
    await evaluate(cdp, 'window.allowWorkspaceErasure = true')
    await perform()
    await waitUntil('Workspace erasure retries after the X profile and its window are gone', () => evaluate<boolean>(cdp, `
      document.body.innerText.includes('Workspace data and the X browser profile on this Mac were deleted.')
        && window.erasureSteps.join(',') === 'remove,getState-session,destroy-session,getState-composer,destroy-composer,remove,remove,workspace,remove,workspace'`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
  await typeConfirmation()
  await perform()
  await waitUntil('The web workspace reports only the data it erased', () => evaluate<boolean>(cdp, `
    document.body.innerText.includes('Workspace data on this install was deleted.')
      && !document.body.innerText.includes('Workspace data and the X browser profile on this Mac were deleted.')`), 5_000)
}

async function checkXBrowserSession(cdp: Cdp): Promise<void> {
  const endpoint = '/api/postline/twitter/browser-session'
  await auditPage(`${site}/accounts`, { cdp })
  const hostedStatus = await evaluate<number>(cdp, `fetch('${endpoint}').then(response => response.status)`)
  if (hostedStatus !== 404) fail('accounts', 'X browser session', 'the hosted process exposed the desktop session')
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const send = window.fetch.bind(window)
    const profile = 'postline-x-12345678-1234-5678-9012-123456789012'
    window.xSessionWrites = 0
    window.xSessionImports = 0
    window.xSessionOpens = []
    window.xSessionNavigations = []
    window.xSessionInspections = 0
    window.xSessionWatch = null
    window.xSessionLinkedPost = null
    window.xDeleteOperations = []
    window.xDeleteRecorded = false
    window.xSessionDestroyed = []
    window.xSessionState = { state: 'connected', handle: 'postline_test', measurements: [{ id: '4321', counts: { likes: 2 } }] }
    window.craft = { app: { nativePlatformControls: false }, capabilities: { nativePlatformControls: false }, window: {
      async openExternal(options) {
        window.xSessionOpens.push(options)
        sessionStorage.setItem('test-x-window-open', 'true')
        return { name: profile }
      },
      async _call(action, input, name) {
        if (!sessionStorage.getItem('test-x-window-open')) throw new Error('Window not found')
        if (name === profile + '-composer' && window.xDeleteOperations.length) {
          if (action === 'destroy') return
          for (const [stage, result] of [['open', 'open'], ['ready', 'ready'], ['select', 'waiting'], ['result', 'deleted']]) {
            if (input?.code.includes('location.href, ' + JSON.stringify(stage))) return result
          }
          throw new Error('Unexpected X deletion stage')
        }
        if (action === 'loadURL' && name === profile) {
          window.xSessionNavigations.push({ url: input.url, name })
          return
        }
        if (action === 'destroy' && name === profile + '-listening') {
          window.xSessionDestroyed.push(name)
          return
        }
        if (action !== 'executeJavaScript' || (name !== profile && name !== profile + '-listening') || !input.code.includes('AppTabBar_Profile_Link'))
          throw new Error('Unexpected X window inspection')
        window.xSessionInspections++
        return JSON.stringify(window.xSessionState)
      },
    } }
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href)
      if (sessionStorage.getItem('test-x-review-queue') && url.pathname === '/api/postline/queue' && options?.method !== 'POST') {
        const linked = Boolean(window.xSessionLinkedPost)
        return Promise.resolve(Response.json({ ok: true, data: { nextCursor: null, items: [{
          id: 711, status: linked ? 'published' : 'failed', body: 'A reviewed X post', createdAt: new Date().toISOString(),
          providers: [{ provider: 'twitter', handle: 'postline_test', status: linked ? 'published' : 'failed',
            ...(linked ? window.xDeleteRecorded ? { xBrowserDeleted: true }
              : { remoteUrl: 'https://x.com/postline_test/status/246811', xBrowserDelete: 712 }
              : { xBrowserReview: 712, failureReason: 'X did not confirm the post.' }) }],
        }] } }))
      }
      if (url.pathname === '/api/postline/queue/delete-x-browser-post') {
        const body = JSON.parse(options.body)
        window.xDeleteOperations.push(body)
        if (body.target_id !== 712) return Promise.resolve(Response.json({ ok: false, error: 'Unexpected X target' }, { status: 422 }))
        let data
        if (body.operation === 'prepare') data = { profile, handle: 'postline_test', id: '246811', receipt: 'fixture-receipt' }
        if (body.operation === 'authorize') data = body.receipt === 'fixture-receipt' ? 'fixture-grant' : null
        if (body.operation === 'result') {
          window.xDeleteRecorded = body.token === 'fixture-grant' && body.state === 'deleted'
          data = window.xDeleteRecorded
        }
        return Promise.resolve(Response.json({ ok: true, data }))
      }
      if (url.pathname === '/api/postline/queue/link-x-browser-post') {
        window.xSessionLinkedPost = JSON.parse(options.body)
        return Promise.resolve(Response.json({ ok: true, data: { url: 'https://x.com/postline_test/status/246811' } }))
      }
      if (url.pathname === '/api/postline/listening' && options?.method === 'POST') {
        window.xSessionWatch = JSON.parse(options.body)
        return Promise.resolve(Response.json({ ok: true, data: {} }))
      }
      if (url.pathname === '${endpoint}/listening') {
        window.xSessionImports++
        const { handle, posts } = JSON.parse(options.body)
        if (options.method !== 'POST' || handle !== 'postline_test' || posts[0]?.authorHandle !== 'fixture_author')
          return Promise.resolve(Response.json({ ok: false, error: 'Invalid session Listening request' }, { status: 422 }))
        return Promise.resolve(Response.json({ ok: true, data: { watches: 1, created: 1 } }))
      }
      if (url.pathname === '${endpoint}/metrics') {
        window.xSessionImports++
        const { handle, measurements } = JSON.parse(options.body)
        if (options.method !== 'POST' || handle !== 'postline_test' || measurements[0]?.counts.likes !== 2)
          return Promise.resolve(Response.json({ ok: false, error: 'Invalid session metrics request' }, { status: 422 }))
        return Promise.resolve(Response.json({ ok: true, data: { synced: 1 } }))
      }
      if (url.pathname !== '${endpoint}') return send(input, options)
      if (options?.method === 'POST') {
        window.xSessionWrites++
        const { handle, signed_out, needs_check, needs_layout_check, checked_layout } = JSON.parse(options.body)
        if (needs_check || signed_out) {
          if (needs_check || localStorage.getItem('test-x-session-handle'))
            localStorage.setItem('test-x-session-needs-check', '1')
          if (needs_layout_check) localStorage.setItem('test-x-session-needs-layout-check', '1')
        }
        else {
          if (!checked_layout && localStorage.getItem('test-x-session-needs-layout-check'))
            return Promise.resolve(Response.json({ ok: false, error: 'Layout check required' }, { status: 422 }))
          localStorage.removeItem('test-x-session-needs-check')
          localStorage.removeItem('test-x-session-needs-layout-check')
          localStorage.removeItem('test-x-session-listening-attention')
          localStorage.setItem('test-x-session-handle', handle)
        }
      }
      return Promise.resolve(Response.json({ ok: true, data: {
        profile, handle: localStorage.getItem('test-x-session-handle'), needsCheck: localStorage.getItem('test-x-session-needs-check') === '1',
        needsLayoutCheck: localStorage.getItem('test-x-session-needs-layout-check') === '1',
        listeningNeedsAttention: localStorage.getItem('test-x-session-listening-attention') === '1',
      } }))
    }
  ` })

  const section = `document.querySelector('[aria-labelledby="x-browser-session-title"]')`
  const open = `${section}?.querySelector('button')`
  const check = `${section}?.querySelectorAll('button')[1]`
  const queuePrefs = await evaluate<Array<[string, string | null]>>(cdp, `
    ['postline.queue.view.v2', 'postline.queue.tab'].map(key => [key, localStorage.getItem(key)])`)
  try {
    await auditPage(`${site}/accounts`, { cdp })
    await waitUntil('The isolated X browser controls are ready', () => evaluate<boolean>(cdp, `Boolean(${open}?.getClientRects().length && !${open}.disabled)`), 5_000)
    await evaluate(cdp, `${check}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Checking sign-in requires an open X window', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Open X and wait') && window.xSessionOpens.length === 0`), 5_000)
    await evaluate(cdp, `${open}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The visible isolated X window is requested', () => evaluate<boolean>(cdp, `
      window.xSessionOpens.length === 1 && window.xSessionOpens[0].url === 'https://x.com/home'
        && window.xSessionOpens[0].name === window.xSessionOpens[0].dataStore && !window.xSessionOpens[0].headless`), 5_000)
    await evaluate(cdp, `${check}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The checked X handle is saved', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Last confirmed as @postline_test') && window.xSessionWrites === 1`), 5_000)
    await evaluate(cdp, `${section}.querySelectorAll('button')[4].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The confirmed X profile opens in the isolated child window', () => evaluate<boolean>(cdp, `
      window.xSessionNavigations[0]?.url === 'https://x.com/postline_test'
        && window.xSessionNavigations[0].name === window.xSessionOpens[0].dataStore
        && ${section}.textContent.includes('Your profile is opening in the X window')
        && window.xSessionWrites === 1 && window.xSessionImports === 0`), 5_000)
    await evaluate(cdp, `${section}.querySelectorAll('button')[5].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('X Mentions opens without importing any posts', () => evaluate<boolean>(cdp, `
      window.xSessionNavigations[1]?.url === 'https://x.com/notifications/mentions'
        && window.xSessionNavigations[1].name === window.xSessionOpens[0].dataStore
        && ${section}.textContent.includes('Mentions is opening in the X window')
        && window.xSessionWrites === 1 && window.xSessionImports === 0`), 5_000)
    await evaluate(cdp, `${section}.querySelectorAll('button')[2].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Reading visible engagement saves the X measurements', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Updated 1 published post in Analytics.')`), 5_000)
    await evaluate(cdp, `${section}.querySelectorAll('button')[3].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Importing requires Search or Mentions', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Open Search or Mentions')`), 5_000)
    await evaluate(cdp, `window.xSessionState.readIssue = 'loading'; ${section}.querySelectorAll('button')[3].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('A timeline still loading leaves imports enabled and persists no hold', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('wait for the page to finish loading')
        && !${section}.querySelectorAll('button')[3].disabled && window.xSessionWrites === 1 && window.xSessionImports === 1`), 5_000)
    await evaluate(cdp, `window.xSessionState.readIssue = 'layout'; ${section}.querySelectorAll('button')[3].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('An unrecognized X layout pauses both imports and records the reason', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Postline could not read this X timeline')
        && ${section}.querySelectorAll('button')[2].disabled && ${section}.querySelectorAll('button')[3].disabled
        && window.xSessionWrites === 2 && window.xSessionImports === 1`), 5_000)
    await auditPage(`${site}/accounts`, { cdp })
    await waitUntil('The layout hold survives reloading the document', () => evaluate<boolean>(cdp, `
      ${section}?.textContent.includes('Postline could not read this X timeline')
        && ${section}.querySelectorAll('button')[3].disabled && !${check}.disabled`), 5_000)
    await evaluate(cdp, `${check}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('A signed-in page without a timeline cannot lift the hold', () => evaluate<boolean>(cdp, `
      ${section}.querySelectorAll('button')[3].disabled && !${check}.disabled
        && window.xSessionInspections === 1 && window.xSessionWrites === 0`), 5_000)
    await evaluate(cdp, `window.xSessionState = { state: 'signed-out' }; ${check}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('A sign-in page leaves the layout hold and last account in place', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Sign in to X, then select Check sign-in')
        && ${section}.textContent.includes('Last confirmed as @postline_test')
        && ${section}.querySelectorAll('button')[3].disabled
        && localStorage.getItem('test-x-session-needs-layout-check') === '1'
        && window.xSessionWrites === 1 && window.xSessionOpens.length === 1`), 5_000)
    await evaluate(cdp, `(() => {
      window.xSessionState = { state: 'connected', handle: 'postline_test', posts: [
        { id: '4321', authorHandle: 'fixture_author', body: 'Postline launch', postedAt: '2026-11-27T05:00:00.000Z' },
      ] }
      ${check}.focus()
    })()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('A readable timeline and confirmed account resume imports', () => evaluate<boolean>(cdp, `
      !${section}.querySelectorAll('button')[3].disabled && window.xSessionWrites === 2 && window.xSessionImports === 0`), 5_000)
    await evaluate(cdp, `${section}.querySelectorAll('button')[3].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The visible X posts are imported into Listening', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Saved 1 new X mention in Listening.')`), 5_000)
    await auditPage(`${site}/accounts`, { cdp })
    await waitUntil('The confirmed handle survives a reload', () => evaluate<boolean>(cdp, `
      ${section}?.textContent.includes('Last confirmed as @postline_test')`), 5_000)

    await evaluate(cdp, `window.xSessionState = { state: 'needs-attention' }; ${section}.querySelectorAll('button')[5].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('An account challenge stops imports and reopens the same named window', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('X needs your attention')
        && ${section}.querySelectorAll('button')[2].disabled && ${section}.querySelectorAll('button')[3].disabled
        && window.xSessionWrites === 1 && window.xSessionImports === 0
        && window.xSessionNavigations.length === 0 && window.xSessionOpens.length === 2
        && window.xSessionOpens.every(opened => opened.name === opened.dataStore)`), 5_000)

    await auditPage(`${site}/accounts`, { cdp })
    await waitUntil('The requested sign-in check survives a document reload', () => evaluate<boolean>(cdp, `
      ${section}?.textContent.includes('Check sign-in to resume browser reads')
        && ${section}.querySelectorAll('button')[2].disabled && ${section}.querySelectorAll('button')[3].disabled
        && !${check}.disabled && window.xSessionWrites === 0`), 5_000)
    await evaluate(cdp, `window.xSessionState = { state: 'connected', handle: 'postline_test' }; ${check}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Confirming sign-in enables X imports again', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Signed in to X as @postline_test.')
        && !${section}.querySelectorAll('button')[2].disabled && !${section}.querySelectorAll('button')[3].disabled
        && window.xSessionWrites === 1`), 5_000)

    await evaluate(cdp, `window.xSessionState = { state: 'signed-out' }; ${section}.querySelectorAll('button')[3].focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('A signed-out page stops Listening imports', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Sign in to X, then select Check sign-in')
        && ${section}.querySelectorAll('button')[3].disabled && window.xSessionWrites === 2
        && window.xSessionImports === 0 && window.xSessionOpens.length === 1 && !${check}.disabled`), 5_000)

    await evaluate(cdp, `${check}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Checking while signed out keeps both reads paused and shows the sign-in page', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Sign in to X, then select Check sign-in')
        && ${section}.textContent.includes('Last confirmed as @postline_test')
        && ${section}.querySelectorAll('button')[2].disabled && ${section}.querySelectorAll('button')[3].disabled
        && window.xSessionWrites === 3 && window.xSessionOpens.length === 2`), 5_000)

    await evaluate(cdp, `localStorage.setItem('test-x-session-listening-attention', '1'); ${open}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Open X brings back the isolated Listening challenge window', () => evaluate<boolean>(cdp, `
      window.xSessionOpens.at(-1)?.name === window.xSessionOpens.at(-1)?.dataStore + '-listening' && !${open}.disabled`), 5_000)
    await evaluate(cdp, `window.xSessionState = { state: 'connected', handle: 'postline_test' }; ${check}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Check sign-in clears the scheduled Listening challenge', () => evaluate<boolean>(cdp, `
      ${section}.textContent.includes('Signed in to X as @postline_test.') && window.xSessionDestroyed[0]?.endsWith('-listening')`), 5_000)

    await auditPage(`${site}/listening`, { cdp })
    const form = "document.querySelector('[data-postline-page=listening] form')"
    const provider = `Array.from(${form}?.querySelectorAll('fieldset button') ?? []).find(button => button.textContent.trim() === 'X')`
    const source = `${form}?.querySelector('select:has(option[value=browser])')`
    const optIn = `Array.from(${form}?.querySelectorAll('label') ?? []).find(label => label.textContent.includes('Check X in the background'))`
    await waitUntil('The Listening watch network buttons are available', () => evaluate<boolean>(cdp, `Boolean(${provider})`), 5_000)
    await evaluate(cdp, `${provider}.click()`)
    await waitUntil('Choosing X defaults to API and keeps browser checks hidden', () => evaluate<boolean>(cdp, `
      ${source}?.value === 'api' && Boolean(${source}?.getClientRects().length) && !${optIn}?.getClientRects().length`), 5_000)
    await evaluate(cdp, `(() => {
      const select = ${source}
      select.value = 'browser'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await waitUntil('A watch using the browser offers an unchecked background setting', () => evaluate<boolean>(cdp, `
      Boolean(${optIn}?.getClientRects().length) && !${optIn}.querySelector('input').checked`), 5_000)
    await evaluate(cdp, `(() => {
      ${optIn}.querySelector('input').click()
      const name = ${form}.querySelector('input[required]')
      const keyword = ${form}.querySelector('textarea[required]')
      name.value = 'Paced X fixture'
      keyword.value = 'quiet research'
      for (const control of [name, keyword]) control.dispatchEvent(new Event('input', { bubbles: true }))
      ${form}.requestSubmit()
    })()`)
    await waitUntil('Saving the watch persists its explicit browser opt-in', () => evaluate<boolean>(cdp, `
      window.xSessionWatch?.name === 'Paced X fixture' && window.xSessionWatch.twitter_read_source === 'browser'
        && window.xSessionWatch.twitter_browser_background === true`), 5_000)

    await evaluate(cdp, `sessionStorage.setItem('test-x-review-queue', '1');
      localStorage.setItem('postline.queue.view.v2', JSON.stringify('list'));
      localStorage.setItem('postline.queue.tab', JSON.stringify('attention'))`)
    await auditPage(`${site}/queue`, { cdp })
    const queue = "document.querySelector('[data-postline-page=queue]')"
    const button = (label: string, scope = queue) => `[...${scope}.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)})`
    const findOnX = button('Find on X')
    const linkPost = button('Link open X post')
    await waitUntil('An uncertain X target offers profile review and keeps Retry hidden', () => evaluate<boolean>(cdp, `
      Boolean(${findOnX}?.getClientRects().length) && !${button('Try again now')}?.getClientRects().length`), 5_000)
    await evaluate(cdp, `${findOnX}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Queue opens the original X account profile', () => evaluate<boolean>(cdp, `
      window.xSessionNavigations.at(-1)?.url === 'https://x.com/postline_test' && !${findOnX}.disabled`), 5_000)

    await evaluate(cdp, `window.xSessionState.posts = [
      { id: '246811', authorHandle: 'postline_test', body: 'A reviewed X post', postedAt: new Date().toISOString() },
    ]; ${linkPost}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const verifyDialog = "document.querySelector('[role=alertdialog]')"
    await waitUntil('The open X post needs explicit confirmation', () => evaluate<boolean>(cdp, `
      ${verifyDialog}?.textContent.includes('including any images') && window.xSessionLinkedPost === null`), 5_000)
    await evaluate(cdp, `${button('Link this post', verifyDialog)}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Queue records only the verified X observation', () => evaluate<boolean>(cdp, `
      window.xSessionLinkedPost?.target_id === 712 && window.xSessionLinkedPost.post?.id === '246811'
        && !${findOnX}?.getClientRects().length`), 5_000)

    const published = `[...${queue}.querySelectorAll('[role=tab]')].find(tab => tab.textContent.trim().startsWith('Published'))`
    await evaluate(cdp, `${published}.click()`)
    const removeOnX = button('Delete from X')
    await waitUntil('The published X row has its Delete from X action', () => evaluate<boolean>(cdp, `
      Boolean(${removeOnX} && ${removeOnX}.closest('details'))`), 5_000)
    await evaluate(cdp, `${removeOnX}.closest('details').open = true; ${removeOnX}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Deleting on X requires an explicit account confirmation', () => evaluate<boolean>(cdp, `
      ${verifyDialog}?.textContent.includes('@postline_test') && window.xDeleteOperations.length === 0`), 5_000)
    await evaluate(cdp, `${button('Cancel', verifyDialog)}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Cancel leaves the X post alone', () => evaluate<boolean>(cdp, `
      !${verifyDialog} && window.xDeleteOperations.length === 0 && !${removeOnX}.disabled`), 5_000)
    await evaluate(cdp, `${removeOnX}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The reopened X confirmation is ready', () => evaluate<boolean>(cdp, `Boolean(${verifyDialog})`), 5_000)
    await evaluate(cdp, `${button('Delete from X', verifyDialog)}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('A confirmed browser deletion preserves Queue history and removes the live link', () => evaluate<boolean>(cdp, `
      window.xDeleteOperations.map(item => item.operation).join(',') === 'prepare,authorize,result'
        && ${queue}.textContent.includes('A reviewed X post') && ${queue}.textContent.includes('Deleted from X')
        && !${queue}.querySelector('a[href="https://x.com/postline_test/status/246811"]')`), 8_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
    await evaluate(cdp, `for (const [key, value] of ${JSON.stringify(queuePrefs)}) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }`)
    await evaluate(cdp, `sessionStorage.removeItem('test-x-window-open'); sessionStorage.removeItem('test-x-review-queue'); localStorage.removeItem('test-x-session-handle'); localStorage.removeItem('test-x-session-needs-check'); localStorage.removeItem('test-x-session-needs-layout-check'); localStorage.removeItem('test-x-session-listening-attention')`)
  }
}

async function checkTwitterDmControls(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const fetchInbox = window.fetch.bind(window)
    window.xInboxRequests = []
    window.fetch = (input, options) => {
      const path = new URL(input instanceof Request ? input.url : input, location.href).pathname
      if (path === '/api/postline/inbox') return Promise.resolve(Response.json({ ok: true, data: {
        conversations: [], unreadCount: 0, providers: {
          supported: [], unavailable: [], accounts: [{ id: 47, provider: 'twitter', handle: 'x_fixture' }],
          twitter: {
            accounts: [{ id: 47, handle: 'x_fixture', older: window.xInboxRequests.length === 1 }],
            readUsage: { estimatedUsd: window.xInboxRequests.length * 0.02, limitUsd: 2 }, maxReadUsd: 0.5, replyUsd: 0.015,
          },
        },
      } }))
      if (path === '/api/postline/inbox/sync') {
        const body = JSON.parse(options.body)
        window.xInboxRequests.push(body)
        return Promise.resolve(Response.json({ ok: true, data: { messages: 1 } }))
      }
      return fetchInbox(input, options)
    }
  ` })
  const group = `document.querySelector('[aria-label="X messages for @x_fixture"]')`
  const sync = `Array.from(${group}?.querySelectorAll('button') || []).find(button => button.textContent.trim() === 'Sync X messages')`
  const older = `Array.from(${group}?.querySelectorAll('button') || []).find(button => button.textContent.trim() === 'Load older from X')`
  try {
    await auditPage(`${site}/inbox`, { cdp })
    await waitUntil('Inbox shows the X refresh and projected cost without a paid request', () => evaluate<boolean>(cdp, `
      Boolean(${sync}?.getClientRects().length) && !${older}?.getClientRects().length
      && document.querySelector('[data-x-inbox-cost]')?.textContent.includes('$0.50')
      && window.xInboxRequests.length === 0`), 5_000)
    await evaluate(cdp, `${sync}.click()`)
    await waitUntil('Inbox offers the next X history page after syncing', () => evaluate<boolean>(cdp, `
      Boolean(${older}?.getClientRects().length) && !${older}.disabled
      && document.querySelector('[data-x-inbox-cost]')?.textContent.includes('$0.02')`), 5_000)
    await evaluate(cdp, `${older}.click()`)
    await waitUntil('X history uses one paid request and updates the cost', () => evaluate<boolean>(cdp, `
      !${older}?.getClientRects().length && document.querySelector('[data-x-inbox-cost]')?.textContent.includes('$0.04')
      && JSON.stringify(window.xInboxRequests) === '[{"twitter_identity_id":47,"older":false},{"twitter_identity_id":47,"older":true}]'`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

async function checkPublicInbox(cdp: Cdp): Promise<void> {
  const fixture = new Database(database)
  try {
    const identity = fixture.query(`INSERT INTO social_identities (uuid, provider, handle, auth_status)
      VALUES (?, 'bluesky', 'inbox-check.example', 'missing') RETURNING id`).get(crypto.randomUUID()) as { id: number }
    fixture.query(`INSERT INTO inbox_mentions (uuid, social_identity_id, remote_id, kind, author, body, url, posted_at)
      VALUES (?, ?, 'browser-check', 'reply', 'fixture-author.example', 'A public reply fixture', ?, CURRENT_TIMESTAMP)`)
      .run(crypto.randomUUID(), identity.id, 'https://bsky.app/profile/fixture-author.example/post/abc')
  }
  finally {
    fixture.close()
  }

  await auditPage(`${site}/inbox`, { cdp })
  const sections = `document.querySelectorAll('[aria-label="Inbox sections"] button')`
  const inbox = `document.querySelector('[data-testid="public-inbox"]')`
  await evaluate(cdp, `${sections}[1].focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Inbox opens public replies with the keyboard and loads the saved post', () => evaluate<boolean>(cdp, `
    ${sections}[1].getAttribute('aria-pressed') === 'true'
      && ${sections}[0].getAttribute('aria-pressed') === 'false'
      && !document.querySelector('[aria-label="Conversations"]').getClientRects().length
      && Boolean(${inbox}?.getClientRects().length)
      && ${inbox}?.querySelector('article p')?.textContent === 'A public reply fixture'
      && ${inbox}?.querySelector('article a')?.href === 'https://bsky.app/profile/fixture-author.example/post/abc'
      && Boolean(${inbox}?.querySelector('article time')?.textContent)`), 5000)
  await evaluate(cdp, `${inbox}.querySelector('[data-public-mark-read]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Inbox marks the reply as read in the database', () => evaluate<boolean>(cdp, `(async () => {
    const payload = await fetch('/api/postline/inbox/mentions').then(response => response.json())
    return !${inbox}?.querySelector('[data-public-mark-read]')?.getClientRects().length
      && payload.data?.entries?.some(entry => entry.author === 'fixture-author.example' && entry.read)
  })()`), 5000)
  await evaluate(cdp, `(() => {
    const original = window.fetch.bind(window)
    window.publicReplyAttempts = []
    window.fetch = (input, options) => {
      if (new URL(input instanceof Request ? input.url : input, location.href).pathname !== '/api/postline/inbox/mentions/reply')
        return original(input, options)
      window.publicReplyAttempts.push(JSON.parse(options.body))
      return Promise.resolve(window.publicReplyAttempts.length === 1
        ? Response.json({ ok: false, error: 'The original post is unavailable.' }, { status: 422 })
        : Response.json({ ok: true, data: { postId: 42, status: 'sent' } }))
    }
  })()`)
  const reply = `${inbox}.querySelector('dialog')`
  await evaluate(cdp, `${inbox}.querySelector('[data-open-public-reply]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Inbox opens the public reply editor and names the receiving account', () => evaluate<boolean>(cdp, `
    ${reply}.open && document.activeElement === ${reply}.querySelector('textarea')
      && ${reply}.querySelector('#public-reply-account').textContent.includes('inbox-check.example')`), 5000)
  await evaluate(cdp, `(() => {
    const text = ${reply}.querySelector('textarea')
    text.value = 'Reply from the browser fixture'
    text.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await waitUntil('The public reply can be sent', () => evaluate<boolean>(cdp, `!${reply}.querySelector('button[type=submit]').disabled`), 5000)
  await evaluate(cdp, `${reply}.querySelector('button[type=submit]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('A rejected public reply keeps the authored text', () => evaluate<boolean>(cdp, `
    ${reply}.open && ${reply}.querySelector('[role=alert]').textContent === 'The original post is unavailable.'
      && ${reply}.querySelector('textarea').value === 'Reply from the browser fixture'
      && !${reply}.querySelector('button[type=submit]').disabled`), 5000)
  await evaluate(cdp, `${reply}.querySelector('button[type=submit]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Inbox confirms the public reply and restores focus', () => evaluate<boolean>(cdp, `
    !${reply}.open && document.activeElement === ${inbox}.querySelector('[data-open-public-reply]')
      && [...${inbox}.querySelectorAll('[role=status]')].some(el => el.innerText === 'Public reply sent.')
      && window.publicReplyAttempts.length === 2 && window.publicReplyAttempts.every(attempt =>
        Number.isInteger(attempt.id) && attempt.text === 'Reply from the browser fixture')`), 5000)
  await evaluate(cdp, `${sections}[0].focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Inbox returns to direct messages', () => evaluate<boolean>(cdp, `
    ${sections}[0].getAttribute('aria-pressed') === 'true'
      && Boolean(document.querySelector('[aria-label="Conversations"]').getClientRects().length)
      && !${inbox}?.getClientRects().length`), 5000)
}

async function checkInstagramPagePicker(cdp: Cdp): Promise<void> {
  const state = 'a'.repeat(64)
  const picker = `document.querySelector('[aria-labelledby="instagram-page-choice-title"]')`
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const send = window.fetch.bind(window)
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href)
      if (url.pathname !== '/api/postline/instagram/pages') return send(input, options)
      if (options?.method === 'POST') {
        const selection = JSON.parse(options.body)
        if (selection.state !== '${state}' || selection.page_id !== '701')
          return Promise.resolve(Response.json({ ok: false, error: 'Unexpected Page selection' }, { status: 422 }))
        sessionStorage.setItem('test-instagram-page', selection.page_id)
        return Promise.resolve(Response.json({ ok: true, data: { handle: 'second.page' } }))
      }
      if (url.searchParams.get('state') !== '${state}')
        return Promise.resolve(Response.json({ ok: false, error: 'Missing connection state' }, { status: 422 }))
      return Promise.resolve(Response.json({ ok: true, data: [
        { pageId: '700', pageName: 'First Page', username: 'first.page', igUserId: '9001' },
        { pageId: '701', pageName: 'Second Page', username: 'second.page', igUserId: '9002' },
      ] }))
    }
  ` })
  try {
    await auditPage(`${site}/accounts?instagram=choose&instagram_state=${state}`, { cdp })
    await waitUntil('The Instagram Page picker shows both authorized Pages', () => evaluate<boolean>(cdp, `
      Boolean(${picker}?.getClientRects().length
        && ${picker}.querySelector('select')?.options[2]?.textContent.includes('Second Page · @second.page')
        && ${picker}.querySelector('button[type="submit"]').disabled)`), 5_000)
    await evaluate(cdp, `(() => {
      const select = ${picker}.querySelector('select')
      select.value = '701'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      ${picker}.querySelector('button[type="submit"]').focus()
    })()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Instagram connects the selected Page and clears the picker', () => evaluate<boolean>(cdp, `
      sessionStorage.getItem('test-instagram-page') === '701'
        && document.querySelector('[data-testid="accounts-page"] [role="status"]')?.textContent.includes('Instagram connected.')
        && !document.querySelector('#instagram-page-choice-title')?.getClientRects().length`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
    await evaluate(cdp, "sessionStorage.removeItem('test-instagram-page')")
  }
}

async function checkChannels(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const send = window.fetch.bind(window)
    window.channelShift = 0
    let measuringChannels = false
    new PerformanceObserver(list => {
      if (!measuringChannels) return
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.channelShift += entry.value
      }
    }).observe({ type: 'layout-shift' })
    const gate = new Promise(resolve => {
      window.releaseChannels = () => { measuringChannels = true; resolve() }
    })
    const status = { provider: 'bluesky', connected: true, canPublish: true, authStatus: 'connected' }
    let channelNeedsReconnect = false
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
        if (path.endsWith('/disconnect')) channelNeedsReconnect = true
        return Response.json({ ok: true })
      }
      if (path !== '/api/postline/bootstrap') return send(input, options)
      await gate
      const response = await send(input, options)
      if (!response.ok) return response
      const payload = await response.json()
      payload.data.accounts = accounts
      payload.data.networkApps = payload.data.networkApps.map(app => app.provider === 'linkedin'
        ? { ...app, configured: true, source: 'settings', clientId: 'test-app', hasSecret: true }
        : app)
      payload.data.providers = payload.data.providers.map(provider => provider.provider === 'bluesky'
        ? { ...provider, ...status, canPublish: !channelNeedsReconnect, handle: accounts.find(account => account.isDefault)?.handle, accounts }
        : provider)
      return Response.json(payload)
    }
  ` })
  try {
    await auditPage(`${site}/accounts?linkedin=tested`, { cdp })
    await waitUntil('Channels reports a completed sign-in test', () => evaluate<boolean>(cdp, `
      [...document.querySelectorAll('[role=status]')].some(node => node.textContent.includes('LinkedIn sign-in passed.'))`), 5_000)
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
    const channelBadge = `${card}.querySelector('[data-channel-status] .rounded-pill')`
    await waitUntil('The channel badge shows a connected state', () => evaluate<boolean>(cdp, `
      ${channelBadge}?.textContent.trim() === 'Connected'
        && ${channelBadge}.classList.contains('bg-success-soft')
        && !${channelBadge}.hasAttribute('aria-live')`), 5_000)
    const channelShift = await evaluate<number>(cdp, 'window.channelShift')
    if (channelShift > 0) fail('accounts', 'channels', `applying the channel response shifted the layout by ${channelShift.toFixed(3)}`)
    const requests = await evaluate<string[]>(cdp, 'window.channelReads')
    if (requests.length !== 1 || requests[0] !== '/api/postline/bootstrap')
      fail('accounts', 'channels', `expected one bootstrap request, saw ${requests.join(', ')}`)

    const twitterApp = `document.querySelector('[data-network-app=twitter]')`
    await evaluate(cdp, `${twitterApp}.querySelector('summary').click()`)
    await waitUntil('Channels shows the current X API read estimate', () => evaluate<boolean>(cdp, `
      ${twitterApp}.querySelector('[data-x-read-usage]')?.getClientRects().length > 0
        && ${twitterApp}.querySelector('[data-x-read-usage]').textContent.includes('Resets at midnight UTC.')`), 5_000)
    await evaluate(cdp, `${twitterApp}.querySelector('summary').click()`)
    const linkedInApp = `document.querySelector('[data-network-app=linkedin]')`
    await evaluate(cdp, `${linkedInApp}.querySelector('summary').click()`)
    await waitUntil('Channels shows the LinkedIn setup guide', () => evaluate<boolean>(cdp, `
      ${linkedInApp}.querySelector('ol').innerText.includes('Sign In with LinkedIn using OpenID Connect')
        && ${linkedInApp}.querySelector('[aria-label="Full LinkedIn setup guide"]')?.href.endsWith('/docs/networks/linkedin.md')`), 5_000)
    const testConnection = `[...${linkedInApp}.querySelectorAll('button')].find(button => button.textContent.trim() === 'Test connection')`
    await waitUntil('The saved network app can be tested', () => evaluate<boolean>(cdp, `
      ${testConnection}?.getClientRects().length > 0 && !(${testConnection}).disabled`), 5_000)
    await evaluate(cdp, `${linkedInApp}.querySelector('[data-app-client-id]').focus()`)
    await cdp.send('Input.insertText', { text: '-unsaved' })
    await waitUntil('The app must be saved before testing changes', () => evaluate<boolean>(cdp, `(${testConnection}).disabled`), 5_000)
    await evaluate(cdp, `${linkedInApp}.querySelector('summary').click()`)

    await evaluate(cdp, `${card}.querySelector('summary').click()`)
    await waitUntil('Channels shows the Bluesky app password guide', () => evaluate<boolean>(cdp, `
      ${card}.querySelector('ol').innerText.includes('Allow access to your direct messages')
        && ${card}.querySelector('[aria-label="Full Bluesky setup guide"]')?.href.endsWith('/docs/networks/bluesky.md')`), 5_000)
    await evaluate(cdp, `${card}.querySelector('summary').click()`)

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
    await waitUntil('A live channel status change updates the badge text and color', () => evaluate<boolean>(cdp, `
      ${channelBadge}?.textContent.trim() === 'Reconnect'
        && ${channelBadge}.classList.contains('bg-warning-soft')
        && !${channelBadge}.classList.contains('bg-success-soft')`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

async function checkDesktopNetworkConsent(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.craft = {
      app: { nativePlatformControls: false },
      capabilities: { nativePlatformControls: false },
      shell: { openExternal: async url => { window.consentBrowser = url } },
    }
    const send = window.fetch.bind(window)
    window.fetch = async (input, options) => {
      const request = new Request(input, options)
      const path = new URL(request.url).pathname
      if (path === '/api/postline/desktop-network-consent') {
        const body = await request.json()
        if (body.operation === 'begin') {
          window.consentStart = body
          window.consentBrowser = ''
          return Response.json({ ok: true, data: {
            id: 'fixture-consent', launchUrl: location.origin + path + '/launch?ticket=fixture-consent',
          } })
        }
        const status = window.consentStart.test ? 'tested' : 'error'
        return Response.json({ ok: true, data: !window.consentFinished ? { state: 'pending' }
          : { state: 'complete', location: '/accounts?twitter=' + status } })
      }
      const response = await send(input, options)
      if (path !== '/api/postline/bootstrap' || !response.ok) return response
      const payload = await response.json()
      for (const provider of payload.data.providers) {
        if (provider.provider === 'twitter') provider.oauthConfigured = true
      }
      for (const app of payload.data.networkApps) {
        if (app.provider === 'twitter') Object.assign(app, { configured: true, source: 'settings', clientId: 'fixture-app', hasSecret: true })
      }
      return Response.json(payload)
    }
  ` })
  try {
    const report = await auditPage(`${site}/accounts`, { cdp })
    for (const error of [...report.errors, ...report.failed]) fail('accounts', 'desktop consent', error)
    const connect = "[...document.querySelectorAll('[data-channel=twitter] button')].find(button => button.textContent.trim() === 'Connect X')"
    const test = "[...document.querySelectorAll('[data-network-app=twitter] button')].find(button => button.textContent.trim() === 'Test connection')"
    for (const testOnly of [false, true]) {
      const trigger = testOnly ? test : connect
      if (testOnly) await evaluate(cdp, "document.querySelector('[data-network-app=twitter] summary').click()")
      await waitUntil('The X consent control is enabled', () => evaluate<boolean>(cdp, `!${trigger}?.disabled && Boolean(${trigger}?.getClientRects().length)`), 5_000)
      await evaluate(cdp, `(${trigger}).focus()`)
      await pressKey(cdp, 'Enter', 13)
      await waitUntil('The Mac opens consent in the system browser', () => evaluate<boolean>(cdp, `
        window.consentBrowser?.includes('/desktop-network-consent/launch?ticket=fixture-consent')
          && window.consentStart?.provider === 'twitter' && window.consentStart?.test === ${testOnly}
          && (${trigger}).disabled
          && document.querySelector('[data-testid=accounts-page]').textContent.includes('Complete the connection in your default browser')
      `), 5_000)
      await evaluate(cdp, 'window.consentFinished = true')
      const message = testOnly ? 'X sign-in passed.' : 'Could not connect X.'
      await waitUntil('The Postline window displays the consent result', () => evaluate<boolean>(cdp, `
        location.pathname === '/accounts' && !location.search && !window.consentStart
          && [...document.querySelectorAll('[role=status]')].some(node => node.textContent.includes(${JSON.stringify(message)}))
      `), 8_000)
    }
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
    await evaluate(cdp, `${addPasskey}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The new passkey in Settings', () => evaluate<boolean>(cdp, "Boolean(document.querySelector('[data-passkey-row]')?.getClientRects().length)"), 10_000)
    await evaluate(cdp, "document.querySelector('[data-setting=sign-out] button').click()")
    const signIn = "document.querySelector('[data-passkey-sign-in]')"
    await waitUntil('The ready passkey sign-in button after signing out', () => evaluate<boolean>(cdp, `
      location.pathname === '/login' && Boolean(${signIn}?.getClientRects().length)
        && ${signIn}.classList.contains('inline-flex') && !${signIn}.disabled`), 15_000)
    await evaluate(cdp, `${signIn}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    try {
      await waitUntil('Passkey sign-in returns to the workspace', () => evaluate<boolean>(cdp, `
        location.pathname === '/composer' && !!document.querySelector('[data-postline-page=composer]')`), 15_000)
    }
    catch (error) {
      const message = await evaluate<string>(cdp, "document.querySelector('[role=alert]')?.textContent?.trim() || ''")
      if (message) throw new Error(`Passkey sign-in reported ${message}`)
      throw error
    }
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

  await evaluate(cdp, `Array.from(document.querySelectorAll('[aria-label="Queue view"] button')).find(button => button.innerText.includes('Agenda')).click()`)
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
  await waitUntil('Analytics explains when there is too little data and fits the phone', () => evaluate<boolean>(cdp, `
    document.querySelector('[aria-labelledby=analytics-chart-title] p')?.textContent.includes('Publish on at least two days')
      && document.querySelector('[aria-labelledby=analytics-chart-title] p').getClientRects().length > 0
      && document.documentElement.scrollWidth - innerWidth <= 1`), 5_000)

  await evaluate(cdp, `document.querySelector('${more}').focus()`)
  await pressKey(cdp, 'Enter', 13)
  const settings = "document.querySelector('#workspace-more[open] a[href=\"/settings\"]')"
  await waitUntil('Settings is available in the phone navigation', () => evaluate<boolean>(cdp, `Boolean(${settings}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `${settings}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The phone Settings link loads the Settings document', () => evaluate<boolean>(cdp, `
    location.pathname === '/settings'
      && new URL(performance.getEntriesByType('navigation')[0].name).pathname === '/settings'
      && Boolean(document.querySelector('[data-postline-page=settings]'))
      && !document.querySelector('[data-postline-shell]')
  `), 10_000)

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
  const publishBlog = `[...document.querySelectorAll('#queue-results article')]
    .find(row => row.textContent.includes('Keyboard scheduling fixture'))
    ?.querySelector('button[class*="hover:bg-surface-hover"]')`
  const gate = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('postline.queue.view.v2', JSON.stringify('list'))
    localStorage.setItem('postline.queue.tab', JSON.stringify('scheduled'))
    window.queueShift = 0
    let measuring = false
    const gate = new Promise(resolve => { window.releaseQueue = () => { measuring = true; resolve() } })
    new PerformanceObserver(list => {
      if (!measuring) return
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.queueShift += entry.value
      }
    }).observe({ type: 'layout-shift' })
    const read = window.fetch.bind(window)
    window.fetch = async (input, options) => {
      const request = new Request(input, options)
      const pathname = new URL(request.url).pathname
      if (request.method !== 'GET' || !['/api/postline/queue', '/api/postline/system', '/api/postline/alerts'].includes(pathname))
        return read(input, options)
      await gate
      const response = await read(input, options)
      if (!response.ok || pathname === '/api/postline/queue') return response
      const payload = await response.json()
      const notice = pathname === '/api/postline/system'
        ? { scheduler: { state: 'never', lastRunAt: null }, paused: false }
        : { unread: 2 }
      return Response.json({ ...payload, data: { ...payload.data, ...notice } })
    }
  ` })
  try {
    await auditPage(`${site}/queue`, { cdp })
    await waitUntil('The Queue lists a loading state', () => evaluate<boolean>(cdp, `
      Boolean(document.querySelector('#queue-results [data-workspace-list-skeleton]')?.getClientRects().length)`), 5_000)
    const queueTop = "document.getElementById('queue-results').getBoundingClientRect().top"
    const before = await evaluate<number>(cdp, `document.fonts.ready.then(() => ${queueTop})`)
    await evaluate(cdp, 'window.releaseQueue()')
    await waitUntil('The scheduled Blog post has a quiet Publish now button', () => evaluate<boolean>(cdp, `
      ${publishBlog}?.textContent.trim() === 'Publish now' && !(${publishBlog}).disabled`), 5_000)
    await waitUntil('The scheduler warning and unread alerts appear', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-scheduler-warning]')?.innerText.includes('the scheduler has not run yet')
        && document.querySelector('[data-attention-link]')?.innerText.includes('2 things need your attention')
    `), 5_000)
    const queueShift = await evaluate<number>(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.queueShift))))')
    const after = await evaluate<number>(cdp, queueTop)
    if (queueShift > 0 || before !== after)
      fail('queue', 'startup', `applying the queued posts and notices shifted the layout by ${queueShift.toFixed(6)} and moved the list from ${before} to ${after}px`)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: gate.identifier })
  }
  await evaluate(cdp, `${publishBlog}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The Queue button publishes the Blog post', () => evaluate<boolean>(cdp, `(async () => {
    const { data } = await (await fetch('/api/postline/queue')).json()
    return data.items.some(item => item.body === 'Keyboard scheduling fixture' && item.status === 'published')
  })()`), 5_000)
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

async function checkPostingSlots(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/queue`, { cdp })
  const panel = "document.querySelector('[data-posting-slots]')"
  const form = `${panel}.querySelector('[data-posting-slot-form]')`
  await evaluate(cdp, `${panel}.querySelector('summary').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Posting slots open from the keyboard', () => evaluate<boolean>(cdp, `
    ${panel}?.open && ${form}.querySelector('option[value=blog]') && ${form}.getClientRects().length > 0`), 5_000)
  const timezone = await evaluate<string>(cdp, `(async () => {
    return (await (await fetch('/api/postline/posting-slots')).json()).data.timezone
  })()`)
  const from = new Date()
  const day = new Date(wallTimeInZone(from, timezone).slice(0, 10) + 'T00:00:00Z')
  const weekday = (day.getUTCDay() + 2) % 7
  const expected = nextPostingSlot([{ provider: 'blog', weekday, minute: 555 }], timezone, from, new Set())
  await evaluate(cdp, `
    ${form}.elements.provider.value = 'blog'
    ${form}.elements.weekday.value = '${weekday}'
    ${form}.elements.time.value = '09:15'
    ${form}.requestSubmit()
  `)
  await waitUntil('The weekly time is saved and displayed', () => evaluate<boolean>(cdp, `
    ${panel}.querySelector('[role=status]')?.innerText === 'Posting slot saved.'
      && ${panel}.querySelector('li')?.innerText.includes('Blog')
      && ${panel}.querySelector('li')?.innerText.includes('09:15')`), 5_000)

  await auditPage(`${site}/composer`, { cdp })
  const actions = "document.querySelector('[data-composer-actions]')"
  const blog = "document.querySelector('[data-provider-toggle=blog]')"
  const body = 'Weekly posting slot fixture'
  await waitUntil('Composer has a Blog channel', () => evaluate<boolean>(cdp, `Boolean(${blog})`), 5_000)
  await evaluate(cdp, `(() => {
    for (const chip of document.querySelectorAll('[data-provider-toggle][aria-pressed=true]'))
      if (chip !== ${blog}) chip.click()
    if (${blog}.getAttribute('aria-pressed') !== 'true') ${blog}.click()
    const editor = document.querySelector('[data-bluesky-text]')
    editor.value = ${JSON.stringify(body)}
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    ${actions}.querySelector('summary').click()
    const add = [...${actions}.querySelectorAll('button')].find(button => button.textContent.trim() === 'Add to queue')
    add.focus()
  })()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Add to queue schedules the post for the weekly time', () => evaluate<boolean>(cdp, `(async () => {
    const { data } = await (await fetch('/api/postline/queue')).json()
    return data.items.some(item => item.body === ${JSON.stringify(body)} && item.status === 'scheduled'
      && item.scheduledAt === ${JSON.stringify(expected)})
  })()`), 5_000)
}

async function checkRecurringPosts(cdp: Cdp): Promise<void> {
  const title = 'Recurring post keyboard fixture'
  await evaluate(cdp, `(async () => {
    const response = await fetch('/api/postline/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ${JSON.stringify(title)}, providers: 'blog' }) })
    if (!response.ok) throw new Error('Could not create the recurring post fixture.')
  })()`)
  await auditPage(`${site}/queue`, { cdp })
  await waitUntil('Queue has a Drafts tab', () => evaluate<boolean>(cdp, `
    [...document.querySelectorAll('[data-queue-tab]')].some(tab => tab.textContent.includes('Drafts'))`), 5_000)
  await evaluate(cdp, `
    [...document.querySelectorAll('[aria-label="Queue view"] button')].find(button => button.textContent.includes('List'))?.click()
    ;[...document.querySelectorAll('[data-queue-tab]')].find(tab => tab.textContent.includes('Drafts')).click()
  `)
  const row = `[...document.querySelectorAll('[data-postline-page=queue] article')].find(row => row.innerText.includes(${JSON.stringify(title)}))`
  await waitUntil('The draft is available to repeat', () => evaluate<boolean>(cdp, `Boolean(${row}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `${row}.querySelector('[aria-label="More post actions"]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await evaluate(cdp, `[...${row}.querySelectorAll('button')].find(button => button.innerText === 'Repeat…').focus()`)
  await pressKey(cdp, 'Enter', 13)
  const dialog = "document.querySelector('[data-recurring-dialog]')"
  await waitUntil('The repeat dialog opens for the selected draft', () => evaluate<boolean>(cdp, `
    ${dialog}.open && ${dialog}.textContent.includes(${JSON.stringify(title)})`), 5_000)
  const timezone = await evaluate<string>(cdp, `document.querySelector('#recurring-zone').textContent`)
  const startAt = wallTimeInZone(new Date(Date.now() + 172_800_000), timezone).slice(0, 16).replace(' ', 'T')
  await evaluate(cdp, `
    ${dialog}.querySelector('[name=interval]').value = 'monthly'
    ${dialog}.querySelector('[name=startAt]').value = ${JSON.stringify(startAt)}
    ${dialog}.querySelector('button[type=submit]').focus()
  `)
  await pressKey(cdp, 'Enter', 13)
  const panel = "document.querySelector('[data-recurring-posts]')"
  const rule = `${panel}.querySelector('[data-recurring-rule]')`
  await waitUntil('The next monthly repeat is listed', () => evaluate<boolean>(cdp, `
    !${dialog}.open && ${panel}.open && ${rule}?.textContent.includes(${JSON.stringify(title)})
      && ${rule}.textContent.includes('monthly') && ${rule}.textContent.includes('Blog')`), 5_000)
  await evaluate(cdp, `[...${rule}.querySelectorAll('button')].find(button => button.textContent === 'Pause').click()`)
  await waitUntil('The repeat can be paused', () => evaluate<boolean>(cdp, `${rule}?.innerText.includes('Paused')`), 5_000)
  await evaluate(cdp, `[...${rule}.querySelectorAll('button')].find(button => button.textContent === 'Edit schedule').click()`)
  await waitUntil('Editing shows the existing local time and cadence', () => evaluate<boolean>(cdp, `
    ${dialog}.open && ${dialog}.querySelector('[name=startAt]').value === ${JSON.stringify(startAt)}
      && ${dialog}.querySelector('[name=interval]').value === 'monthly'`), 5_000)
  await pressKey(cdp, 'Escape', 27)
  await waitUntil('Escape closes the repeat dialog', () => evaluate<boolean>(cdp, `!${dialog}.open`), 5_000)
}

async function checkDraftFeeds(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/queue`, { cdp })
  const panel = "document.querySelector('[data-draft-feeds]')"
  const form = `${panel}.querySelector('[data-draft-feed-form]')`
  await evaluate(cdp, `${panel}.querySelector('summary').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Draft feeds open from the keyboard', () => evaluate<boolean>(cdp, `
    ${panel}?.open && [...${panel}.querySelectorAll('p')].some(p => p.innerText === 'No draft feeds yet.')
      && !${form}.querySelector('button[type=submit]').disabled`), 5_000)
  await evaluate(cdp, `
    ${form}.elements.name.value = 'Private fixture'
    ${form}.elements.url.value = 'http://localhost/feed.xml'
    ${form}.requestSubmit()
  `)
  await waitUntil('A private feed is refused without creating a subscription', () => evaluate<boolean>(cdp, `
    ${panel}.querySelector('[role=alert]')?.innerText.includes('public HTTP or HTTPS feed')
      && !${panel}.querySelector('[data-draft-feed]')`), 5_000)
}

async function checkTrackedLinks(cdp: Cdp): Promise<void> {
  await auditPage(`${site}/analytics`, { cdp })
  const form = "document.querySelector('[data-tracked-link-form]')"
  const result = "document.querySelector('[data-tracked-link-result]')"
  await waitUntil('Tracking can build a tagged URL on a local install', () => evaluate<boolean>(cdp, `
    ${form}?.textContent.includes('Short links need a public HTTPS Postline server.')
      && !${form}.querySelector('button[value=shorten]').getClientRects().length
      && !${form}.querySelector('button[value=tag]').disabled`), 5_000)
  await evaluate(cdp, `
    ${form}.elements.destination.value = 'https://example.org/story?edition=1#more'
    ${form}.elements.source.value = 'Mastodon'
    ${form}.elements.campaign.value = 'Product news'
    ${form}.querySelector('button[value=tag]').focus()
  `)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The builder preserves the destination query and fragment', () => evaluate<boolean>(cdp, `
    ${result}?.value === 'https://example.org/story?edition=1&utm_source=Mastodon&utm_campaign=Product+news#more'`), 5_000)
}

async function checkAnalytics(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const actualFetch = window.fetch.bind(window)
    window.analyticsReads = 0
    window.xMetricsEnabled = false
    window.xMetricsRefreshes = 0
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href)
      if (url.pathname === '/api/postline/metrics/sync') {
        if (options?.method !== 'POST' || JSON.parse(options.body).include_x !== true)
          return Promise.resolve(Response.json({ ok: false, error: 'Missing explicit paid refresh' }, { status: 422 }))
        window.xMetricsRefreshes++
        return Promise.resolve(Response.json({ ok: true, data: { synced: 1, errors: [] } }))
      }
      if (url.pathname !== '/api/postline/analytics' || !url.searchParams.has('page')) return actualFetch(input, options)
      const days = Number(url.searchParams.get('days'))
      const page = Number(url.searchParams.get('page'))
      window.analyticsReads++
      const counts = { likes: 1 + window.xMetricsRefreshes, replies: 0, views: 12 }
      const provider = window.xMetricsEnabled ? 'twitter' : 'instagram'
      return Promise.resolve(Response.json({ ok: true, data: {
        totalPosts: days === 7 ? 1 : 26,
        stats: {
          minSample: 3,
          engagement: { likes: counts.likes, replies: 0, reposts: 0, countsByProvider: [{ provider, ...counts }] },
        },
        series: [{ label: 'Monday', value: days === 7 ? 0 : 25 }, { label: 'Tuesday', value: 1 }],
        channelMix: [{ provider, published: days === 7 ? 1 : 26, share: 100 }],
        posts: [{ id: page, title: page === 1 ? 'First example' : 'Next example', publishedAt: '2026-11-25 10:00:00', targets: [{ id: page, provider, handle: null, counts }] }],
        page,
        pageCount: days === 7 ? 1 : 2,
        xMetricsEnabled: window.xMetricsEnabled,
      } }))
    }
  ` })
  try {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await auditPage(`${site}/analytics`, { cdp })
    await waitUntil('Analytics shows measured zero and omits unavailable reposts in both tables', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-analytics-engagement]')?.textContent === '1'
        && document.querySelector('[data-analytics-engagement-trend]')?.textContent === '1 like or reaction · 0 replies'
        && document.querySelector('[data-analytics-network-engagement] li')?.textContent.includes('1 like · 0 replies · 12 views')
        && document.querySelector('[aria-labelledby=published-posts-title] tbody').textContent.includes('First example')
        && document.querySelector('[aria-labelledby=published-posts-title] tbody').textContent.includes('1 like · 0 replies · 12 views')`), 10_000)
    await waitUntil('The chart is drawn with the dark theme series colour', () => evaluate<boolean>(cdp, `(() => {
      const canvas = document.querySelector('[data-analytics-chart]')
      if (!document.documentElement.classList.contains('dark') || !canvas?.clientWidth || !canvas?.clientHeight) return false
      const [r, g, b] = getComputedStyle(canvas).getPropertyValue('--info').trim().slice(1).match(/../g).map(part => parseInt(part, 16))
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === r && pixels[i + 1] === g && pixels[i + 2] === b && pixels[i + 3] === 255) return true
      }
      return false
    })()`), 5_000)
    await evaluate(cdp, "[...document.querySelectorAll('[aria-label=\"Published posts pages\"] button')].find(button => button.textContent === 'Next').focus()")
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The next page shows its posts and restores keyboard focus', () => evaluate<boolean>(cdp, `
      document.querySelector('[aria-labelledby=published-posts-title] tbody').textContent.includes('Next example')
        && document.activeElement.id === 'published-posts-title'`), 5_000)
    await evaluate(cdp, `
      const range = document.querySelector('[data-postline-page=analytics] select')
      range.value = '7'; range.dispatchEvent(new Event('change', { bubbles: true }))`)
    await waitUntil('A short range updates the totals, restarts paging and explains the missing trend', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-analytics-total]')?.textContent === '1'
        && document.querySelector('[aria-labelledby=published-posts-title] tbody').textContent.includes('First example')
        && !document.querySelector('[data-analytics-chart]').getClientRects().length`), 5_000)
    await evaluate(cdp, `document.querySelector('aside a[href="/queue"]').click()`)
    await waitUntil('Leaving Analytics for Queue', () => evaluate<boolean>(cdp, "location.pathname === '/queue'"), 5_000)
    await evaluate(cdp, `document.querySelector('aside a[href="/analytics"]').click()`)
    await waitUntil('Analytics reloads its data on revisit', () => evaluate<boolean>(cdp, `
      location.pathname === '/analytics' && window.analyticsReads === 4
        && document.querySelector('[data-analytics-total]')?.textContent === '26'`), 5_000)
    const refresh = `document.querySelector('button[aria-describedby="analytics-refresh-cost"]')`
    if (await evaluate<boolean>(cdp, `Boolean(${refresh}?.getClientRects().length)`))
      fail('analytics', 'X engagement', 'the paid refresh was visible before opt-in')
    await evaluate(cdp, `
      window.xMetricsEnabled = true
      const paidRange = document.querySelector('[data-postline-page=analytics] select')
      paidRange.value = '90'; paidRange.dispatchEvent(new Event('change', { bubbles: true }))`)
    await waitUntil('The paid refresh appears with its cost description', () => evaluate<boolean>(cdp, `
      Boolean(${refresh}?.getClientRects().length && document.getElementById('analytics-refresh-cost')?.textContent.includes('daily read budget'))`), 5_000)
    await evaluate(cdp, `${refresh}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The paid refresh reports updated counts and retains focus', () => evaluate<boolean>(cdp, `
      window.xMetricsRefreshes === 1
        && document.querySelector('[data-analytics-engagement]')?.textContent === '2'
        && document.activeElement === ${refresh}
        && document.querySelector('[aria-labelledby=network-engagement-title] [role=status]')?.textContent === 'Engagement refreshed.'`), 5_000)
  }
  finally {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
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
    const post = `[...document.querySelectorAll('article[role=button]')].find(item => item.textContent.includes('Plan the scheduling fixture') && item.getClientRects().length > 0)`
    for (const mode of [MODES[1], MODES[2], MODES[0]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.mobile })
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode.scheme }] })
      const report = await auditPage(`${site}/campaigns`, { cdp })
      for (const error of report.errors) fail('campaigns', mode.name, `console: ${error}`)
      await waitUntil('The planned campaign post', () => evaluate<boolean>(cdp, `Boolean(${post})`), 5_000)
      const layout = await evaluate<{ overflow: number, stacked: boolean, accentMatches: boolean }>(cdp, `(() => {
        const board = document.querySelector('[aria-label="Campaign plan"]').getBoundingClientRect()
        const panel = document.querySelector('[aria-label="Campaign tools"]').getBoundingClientRect()
        const create = [...document.querySelectorAll('[data-postline-page=campaigns] button')].find(button => button.textContent.trim() === 'New campaign')
        const accent = document.createElement('span').style
        accent.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--accent')
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          stacked: panel.bottom <= board.top,
          accentMatches: getComputedStyle(create).backgroundColor === accent.backgroundColor,
        }
      })()`)
      if (layout.overflow > 1 || layout.stacked !== mode.mobile)
        fail('campaigns', mode.name, 'the populated workspace does not fit its layout')
      if (!layout.accentMatches) fail('campaigns', mode.name, 'the primary button does not use the workspace accent')
      const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(out, `campaigns-planned-${mode.name}.png`), Buffer.from(shot.data, 'base64'))
    }
    const previous = `document.querySelector('button[aria-label="Previous six weeks"]')`
    const calendarTitle = `document.querySelector('[aria-label="Campaign plan"] > header strong').textContent`
    const startWindow = await evaluate<string>(cdp, calendarTitle)
    await evaluate(cdp, `${previous}.focus()`)
    const tooltip = `document.getElementById(${previous}.getAttribute('aria-describedby'))`
    await waitUntil('The calendar arrow shows its tooltip on focus', () => evaluate<boolean>(cdp, `
      Boolean(${tooltip}?.getClientRects().length) && ${tooltip}.textContent.includes('Previous six weeks')`), 5_000)
    await pressKey(cdp, 'Escape', 27)
    await waitUntil('Escape hides the arrow tooltip and keeps focus', () => evaluate<boolean>(cdp, `
      !${tooltip}?.getClientRects().length && document.activeElement === ${previous}`), 5_000)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The keyboard shifts the campaign calendar', () => evaluate<boolean>(cdp, `
      ${calendarTitle} !== ${JSON.stringify(startWindow)}`), 5_000)
    await evaluate(cdp, `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Campaign start').click()`)
    await waitUntil('Campaign start restores the calendar window', () => evaluate<boolean>(cdp, `
      ${calendarTitle} === ${JSON.stringify(startWindow)}`), 5_000)
    await evaluate(cdp, `${post}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const picker = `document.querySelector('[data-postline-schedule-picker] [data-date-time-trigger]')`
    await waitUntil('The campaign editor opens with the saved post fields', () => evaluate<boolean>(cdp, `
      Boolean(${picker}?.getClientRects().length)
        && document.querySelector('input[placeholder=\"The first signal\"]')?.value === 'Plan the scheduling fixture'
        && document.querySelector('textarea[placeholder=\"Write the post…\"]')?.value === 'Keep the campaign clock time.'`), 5_000)
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
    const views = `document.querySelector('[data-stx-segmented-control][aria-label="Campaign view"]')`
    await evaluate(cdp, `${views}.querySelector('[aria-label=List]').focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Campaign List is selected and shows the same post', () => evaluate<boolean>(cdp, `
      ${views}.querySelector('[aria-label=List]').getAttribute('aria-pressed') === 'true'
        && ${views}.querySelector('[aria-label=Calendar]').getAttribute('aria-pressed') === 'false'
        && [...document.querySelectorAll('[data-campaign-list-row]')].some(row => row.getClientRects().length && row.textContent.includes('Plan the scheduling fixture'))`), 5_000)
    await evaluate(cdp, `${post}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const remove = `[...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.textContent.trim() === 'Delete')`
    await waitUntil('The saved campaign post can be deleted', () => evaluate<boolean>(cdp, `Boolean(${remove})`), 5_000)
    await evaluate(cdp, `${remove}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const dialog = `document.activeElement?.closest('[role=alertdialog]')`
    await waitUntil('The delete dialog focuses Cancel first', () => evaluate<boolean>(cdp, `
      document.activeElement?.textContent === 'Cancel' && ${dialog}?.textContent.includes('Delete this planned post?')`), 5_000)
    await pressKey(cdp, 'Escape', 27)
    await waitUntil('Cancel keeps the planned post in the editor', () => evaluate<boolean>(cdp, `
      document.activeElement === ${remove}
        && document.querySelector('input[placeholder="The first signal"]')?.value === 'Plan the scheduling fixture'`), 5_000)
    await pressKey(cdp, 'Enter', 13)
    await pressKey(cdp, 'Tab', 9)
    if (!await evaluate<boolean>(cdp, `${dialog} && document.activeElement.textContent === 'Delete post'`))
      fail('campaigns', 'keyboard', 'Tab did not reach the delete confirmation')
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Confirming delete removes the planned post', () => evaluate<boolean>(cdp, `
      !${post} && document.querySelector('#stx-toast-container')?.textContent.includes('Post removed')`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: recommendation.identifier })
  }
}

async function checkCampaignLocalDates(cdp: Cdp): Promise<void> {
  const setZone = (timezone: string) => evaluate<boolean>(cdp, `(async () => {
    const result = await fetch('/api/postline/settings/workspace', { method: 'POST', body: new URLSearchParams({ timezone: ${JSON.stringify(timezone)} }) })
    return result.ok
  })()`)
  const original = await evaluate<string>(cdp, `(async () => (await (await fetch('/api/postline/settings/workspace')).json()).data.timezone)()`)
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const fixed = new Date('2026-11-27T07:00:00Z').getTime()
    window.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [fixed])) }
      static now() { return fixed }
    }
  ` })
  try {
    if (!await setZone('America/Los_Angeles')) throw new Error('Could not set the campaign workspace time zone.')
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' })
    await auditPage(`${site}/campaigns`, { cdp })
    const create = `[...document.querySelectorAll('[data-postline-page=campaigns] button')].find(button => button.getClientRects().length && ['New campaign', 'Create a campaign'].includes(button.textContent.trim()))`
    await waitUntil('A new campaign can be opened', () => evaluate<boolean>(cdp, `Boolean(${create})`), 5_000)
    await evaluate(cdp, `${create}.click()`)
    const name = `document.querySelector('input[placeholder="Autumn product launch"]')`
    const start = `${name}.closest('form').querySelector('input[type=date]')`
    await waitUntil('At 11 pm Pacific the campaign starts on the workspace calendar day', () => evaluate<boolean>(cdp, `
      ${name}?.getClientRects().length > 0 && ${start}.value === '2026-11-26'`), 5_000)
    await evaluate(cdp, `${name}.focus()`)
    await cdp.send('Input.insertText', { text: 'Pacific kickoff' })
    await pressKey(cdp, 'Escape', 27)
    await waitUntil('Closing an edited campaign asks before discarding', () => evaluate<boolean>(cdp, `
      document.activeElement?.textContent === 'Cancel'
        && document.activeElement.closest('[role=alertdialog]')?.textContent.includes('Discard changes?')`), 5_000)
    await pressKey(cdp, 'Escape', 27)
    await waitUntil('Cancel restores focus and preserves the campaign edit', () => evaluate<boolean>(cdp, `
      document.activeElement === ${name} && ${name}.value === 'Pacific kickoff'`), 5_000)
    await evaluate(cdp, `${name}.closest('form').querySelector('textarea').focus()`)
    await cdp.send('Input.insertText', { text: 'Verify the local campaign date.' })
    await evaluate(cdp, `${name}.closest('form').querySelector('button[type=submit]').click()`)
    await waitUntil('The saved campaign keeps its Pacific start date', () => evaluate<boolean>(cdp, `(async () => {
      const response = await fetch('/api/postline/campaigns')
      const { data } = await response.json()
      return data.selected?.campaign.name === 'Pacific kickoff'
        && data.selected.campaign.startDate === '2026-11-26'
        && data.selected.campaign.timezone === 'America/Los_Angeles'
    })()`), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' })
    if (!await setZone(original)) throw new Error('Could not restore the workspace time zone after the campaign test.')
  }
}

async function watchPageSecurity(cdp: Cdp): Promise<void> {
  const responses = await Promise.all([fetch(`${site}/login`), fetch(`${site}/login`)])
  const nonces = await Promise.all(responses.map(async (response) => {
    const policy = response.headers.get('content-security-policy') || ''
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
    if (!nonce || policy.includes('unsafe-eval') || !policy.includes("frame-ancestors 'self'") || !policy.includes("form-action 'self'"))
      throw new Error('The page response needs an enforcing CSP with a script nonce and same-origin frame and form directives.')
    if (response.headers.get('cross-origin-opener-policy') !== 'same-origin-allow-popups'
      || !response.headers.get('permissions-policy') || response.headers.get('x-content-type-options') !== 'nosniff')
      throw new Error('The page response is missing its opener, permissions, or content-type header.')
    const html = await response.text()
    if (!html.includes('data-stx-csp-script') || !html.includes(`nonce="${nonce}"`))
      throw new Error('The sign-in page did not receive nonce-authorized STX bindings.')
    return nonce
  }))
  if (nonces[0] === nonces[1]) throw new Error('The web server reused a CSP nonce.')

  await cdp.send('Runtime.addBinding', { name: 'reportPostlineCspViolation' })
  cdp.on('Runtime.bindingCalled', ({ name, payload }) => {
    if (name === 'reportPostlineCspViolation') failures.push(`CSP violation: ${payload}`)
  })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    document.addEventListener('securitypolicyviolation', event => {
      reportPostlineCspViolation(location.pathname + ' ' + event.violatedDirective + ' ' + event.blockedURI)
    })
    const warn = console.warn
    console.warn = (...args) => {
      const lines = args.map(String)
      if (lines.some(line => line.includes('[stx:csp]'))) reportPostlineCspViolation(location.pathname + ' ' + lines.join(' '))
      warn.apply(console, args)
    }
  ` })
}

async function checkFirstRun(cdp: Cdp): Promise<void> {
  const copy = spanishWorkspace
    ? {
        login: 'Inicia sesión en Postline', setup: 'Configurar un espacio de trabajo nuevo',
        account: 'Crea la cuenta del propietario', mismatch: 'Las contraseñas no coinciden.',
        workspace: 'Ponle un nombre a tu espacio de trabajo', channels: 'Elige un canal para publicar',
        complete: 'Tu primera publicación está lista',
      }
    : {
        login: 'Sign in to Postline', setup: 'Set up a new workspace',
        account: 'Create the owner account', mismatch: 'Passwords do not match.',
        workspace: 'Name your workspace', channels: 'Choose a publishing channel', complete: 'Your first post is ready',
      }
  const setup = `document.querySelector('[data-testid="setup-page"]')`
  const input = (name: string): string => `${setup}.querySelector(` + JSON.stringify(`input[name=${name}]`) + ')'
  const type = async (selector: string, value: string): Promise<void> => {
    await waitUntil('The setup input', () => evaluate<boolean>(cdp, `Boolean(${selector}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${selector}.focus(); ${selector}.select()`)
    await cdp.send('Input.insertText', { text: value })
  }
  const click = (selector: string): Promise<void> => evaluate(cdp, `${selector}.click()`)
  const heading = (title: string): Promise<void> => waitUntil(title, () => evaluate<boolean>(cdp, `${setup}?.querySelector('h1').textContent === ${JSON.stringify(title)}`), 20_000)

  await auditPage(`${site}/login`, { cdp })
  const login = `document.querySelector('[data-testid="login-page"]')`
  const setupLink = `document.querySelector('a[href="/setup"]')`
  await waitUntil('Sign-in offers setup in the workspace language', () => evaluate<boolean>(cdp, `
    ${login}?.lang === ${JSON.stringify(spanishWorkspace ? 'es' : 'en')}
      && ${login}.querySelector('h1')?.textContent === ${JSON.stringify(copy.login)}
      && Boolean(${setupLink}?.getClientRects().length)
      && ${setupLink}.textContent.trim() === ${JSON.stringify(copy.setup)}
  `), 10_000)
  if (spanishWorkspace) {
    await type(`${login}.querySelector('input[name=email]')`, 'check@postline.test')
    await type(`${login}.querySelector('input[name=password]')`, 'browser-check-password')
    await click(`${login}.querySelector('button[type=submit]')`)
    await waitUntil('Rejected credentials show the Spanish sign-in error', () => evaluate<boolean>(cdp, `
      ${login}.querySelector('[role=alert]')?.textContent === 'El correo electrónico o la contraseña son incorrectos.'
    `), 5_000)
  }
  await click(setupLink)
  await heading(copy.account)
  const workspaceName = marketingScreenshots ? 'Northstar Studio' : 'Browser Workspace'
  await type(input('name'), marketingScreenshots ? 'Alex Rivera' : 'Browser Check')
  await type(input('email'), marketingScreenshots ? 'alex@northstar.example' : 'check@postline.test')
  await type(input('password'), 'browser-check-password')
  await type(input('password_confirmation'), 'wrong-confirmation')
  await click(`${setup}.querySelector('button[type=submit]')`)
  await waitUntil('Registration confirms the password before creating an account', () => evaluate<boolean>(cdp, `${setup}.querySelector('[role=alert]').textContent === ${JSON.stringify(copy.mismatch)}`), 5_000)
  await type(input('password_confirmation'), 'browser-check-password')
  await click(`${setup}.querySelector('button[type=submit]')`)
  await heading(copy.workspace)
  await type(input('workspaceName'), workspaceName)
  await type(input('timezone'), 'America/New_York')
  await click(`${setup}.querySelector('button[type=submit]')`)
  await heading(copy.channels)
  const profileSaved = await evaluate<boolean>(cdp, `(async () => {
    const { data } = await (await fetch('/api/postline/settings/workspace')).json()
    return data.workspaceName === ${JSON.stringify(workspaceName)} && data.timezone === 'America/New_York'
  })()`)
  if (!profileSaved) throw new Error('Setup did not save the workspace name and time zone.')

  await click(`${setup}.querySelector('a[href="/accounts?setup=1"]')`)
  const resume = `document.querySelector('a[href="/setup?step=channels"]')`
  const resumeLabel = spanishWorkspace ? 'Continuar la configuración' : 'Continue setup'
  await waitUntil('Channels links back to setup', () => evaluate<boolean>(cdp, `location.pathname === '/accounts' && ${resume}?.textContent.trim() === ${JSON.stringify(resumeLabel)}`), 15_000)
  await click(resume)
  await heading(copy.channels)
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
    await heading(copy.complete)
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
  const queueLink = `${setup}.querySelector('a[href="/queue"]')`
  await waitUntil('The setup link to Queue is available', () => evaluate<boolean>(cdp, `Boolean(${queueLink}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `${queueLink}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  try {
    await waitUntil('The Queue opens after setup', () => evaluate<boolean>(cdp, `location.pathname === '/queue' && !!document.getElementById('queue-tab-published')`), 15_000)
  }
  catch (error) {
    const state = await evaluate(cdp, `({
      path: location.pathname,
      heading: document.querySelector('h1')?.textContent,
      queue: Boolean(document.querySelector('[data-postline-page=queue]')),
      tabs: document.querySelectorAll('[data-queue-tab]').length,
    })`)
    throw new Error(`${String(error)}. Browser state: ${JSON.stringify(state)}`)
  }
  await click("document.getElementById('queue-tab-published')")
  await waitUntil('The first Blog post is published in the queue', () => evaluate<boolean>(cdp, `
    [...document.querySelectorAll('#queue-results article')].some(row =>
      row.innerText.includes(${JSON.stringify(body)}) && row.querySelector('[data-target-chip][data-state="sent"]')?.textContent.includes('Blog'))`), 5_000)
  await click("document.getElementById('queue-tab-scheduled')")
}

async function checkRejectedPublishInputs(cdp: Cdp): Promise<void> {
  const text = 'Publish validation fixture fallback'
  const lead = 'Publish validation fixture lead'
  const reply = 'Publish validation fixture reply'
  const variant = 'Publish validation fixture variant'
  const threadError = spanishWorkspace ? 'No se pudo leer el hilo.' : 'Could not read the thread.'
  const variantError = spanishWorkspace
    ? 'El texto por canal está disponible para publicaciones individuales.'
    : 'Per-network text is available for single posts.'
  const cases = [
    { thread: '[', error: threadError },
    { thread: JSON.stringify([lead, ' ']), error: threadError },
    { thread: JSON.stringify([lead, reply]), variants: JSON.stringify({ blog: variant }), error: variantError },
  ]
  for (const { error, ...fields } of cases) {
    const result = await evaluate<{ status: number, error: string }>(cdp, `(async () => {
      const body = new URLSearchParams(${JSON.stringify({ text, providers: 'blog', ...fields })})
      const response = await fetch('/api/postline/publish', { method: 'POST', body })
      return { status: response.status, error: (await response.json()).error }
    })()`)
    if (result.status !== 422 || result.error !== error)
      throw new Error(`Publishing invalid thread input should return 422 with “${error}”. Got ${JSON.stringify(result)}.`)
  }

  using fixture = new Database(database, { readonly: true })
  if (fixture.query('SELECT id FROM posts WHERE body IN (?, ?, ?, ?)').get(text, lead, reply, variant))
    throw new Error('The rejected publishing request wrote a post.')
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

async function checkListStates(cdp: Cdp): Promise<void> {
  const views = [
    { route: 'queue', path: '/api/postline/queue', title: 'No scheduled posts', loading: 'Loading posts', data: { items: [], nextCursor: null } },
    {
      route: 'accounts', path: '/api/postline/bootstrap', title: 'No publishing channels available', loading: 'Loading publishing channels',
      data: { providers: [], accounts: [], networkApps: [], unread: { inbox: 0, listening: 0 } },
    },
    { route: 'campaigns', path: '/api/postline/campaigns', title: 'Plan your first campaign', loading: 'Loading campaigns', data: { campaigns: [], selected: null } },
    {
      route: 'analytics', path: '/api/postline/analytics', title: 'No publishing activity in the last 30 days', loading: 'Loading analytics',
      data: { stats: { minSample: 3 }, totalPosts: 0, series: [], channelMix: [], windows: [], posts: [], page: 1, pageCount: 0 },
    },
  ]
  for (const view of views) {
    const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
      const actualFetch = window.fetch.bind(window)
      const failedRead = new Promise(resolve => { window.failListLoad = resolve })
      let reads = 0
      window.fetch = async (input, options) => {
        const url = new URL(input instanceof Request ? input.url : input, location.href)
        if (url.pathname !== ${JSON.stringify(view.path)} || url.searchParams.has('calendar_from')) return actualFetch(input, options)
        if (++reads === 1) {
          await failedRead
          return Response.json({ ok: false, error: 'Temporary list failure' }, { status: 503 })
        }
        return Response.json({ ok: true, data: ${JSON.stringify(view.data)} })
      }
    ` })
    try {
      await auditPage(`${site}/${view.route}`, { cdp })
      if (view.route === 'queue')
        await evaluate(cdp, `
          [...document.querySelectorAll('[aria-label="Queue view"] button')].find(button => button.textContent.trim() === 'List').click()
          document.getElementById('queue-tab-scheduled').click()
        `)
      const container = view.route === 'queue' ? '#queue-results' : `[data-postline-page="${view.route}"]`
      const loadingSelector = view.route === 'accounts' ? '[data-channels-loading] [role=status]' : '[data-workspace-list-skeleton]'
      const skeleton = `document.querySelector('${container} ${loadingSelector}')`
      const errorState = `document.querySelector('${container} [data-stx-error-state]')`
      const empty = `document.querySelector('${container} [data-stx-empty-state]')`
      await waitUntil(`${view.route} shows a named loading status`, () => evaluate<boolean>(cdp, `
        ${skeleton}?.getAttribute('role') === 'status' && ${skeleton}.textContent.trim() === ${JSON.stringify(view.loading)} && ${skeleton}.getClientRects().length > 0`), 5_000)
      await evaluate(cdp, 'window.failListLoad()')
      await waitUntil(`${view.route} announces the load failure`, () => evaluate<boolean>(cdp, `
        ${errorState}?.getAttribute('role') === 'alert' && ${errorState}.getClientRects().length > 0
          && ${errorState}.textContent.includes('Temporary list failure') && !${empty}?.getClientRects().length`), 5_000)
      await evaluate(cdp, `${errorState}.querySelector('button').focus()`)
      await pressKey(cdp, 'Enter', 13)
      await waitUntil(`${view.route} displays the empty result after retry`, () => evaluate<boolean>(cdp, `
        ${empty}?.getClientRects().length > 0 && ${empty}.textContent.includes(${JSON.stringify(view.title)})
          && !${errorState}.getClientRects().length && !${skeleton}.getClientRects().length`), 5_000)
    }
    finally {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
    }
  }
}

async function captureMarketingScreenshots(cdp: Cdp): Promise<void> {
  const draft = 'Our spring field guide is out. We spent a weekend walking the coastline to find the trails worth taking slowly.\n\nhttps://northstar.example/field-notes'
  const posts = [
    'The spring field guide is live. A weekend on the coast, mapped one trail at a time.',
    'Three things we packed for the coast, and one we would leave at home.',
    'The next field guide follows the river inland. Here’s a look at the route.',
  ]
  const seeded = await evaluate<boolean>(cdp, `(async () => {
    for (const [index, text] of ${JSON.stringify(posts)}.entries()) {
      const response = await fetch('/api/postline/queue', { method: 'POST', body: new URLSearchParams({
        text, providers: 'bluesky,linkedin,blog', scheduled_at: '2099-04-' + (12 + index) + ' 13:00:00',
      }) })
      if (!response.ok) return false
    }
    return true
  })()`)
  if (!seeded) throw new Error('Could not seed the photographed Queue.')

  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const actualFetch = window.fetch.bind(window)
    const channels = {
      bluesky: { id: 101, handle: 'northstar.example' },
      linkedin: { id: 102, handle: 'Northstar Studio' },
    }
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href)
      if (url.pathname === '/api/postline/bluesky/link-preview') return Promise.resolve(Response.json({
        ok: true, data: { title: 'Northstar Field Notes', description: 'Trail notes and maps from the coast.', url: 'https://northstar.example/field-notes' },
      }))
      if (url.pathname === '/api/postline/system') return actualFetch(input, options).then(async response => {
        if (!response.ok) return response
        const payload = await response.json()
        return Response.json({ ...payload, data: { ...payload.data, scheduler: { state: 'ok', lastRunAt: new Date().toISOString() } } })
      })
      if (url.pathname !== '/api/postline/bootstrap') return actualFetch(input, options)
      return actualFetch(input, options).then(async response => {
        if (!response.ok) return response
        const payload = await response.json()
        const providers = payload.data.providers.map(provider => {
          const channel = channels[provider.provider]
          if (!channel) return provider
          const account = { ...channel, provider: provider.provider, connected: true, canPublish: true, isDefault: true }
          return { ...provider, ...account, accounts: [account] }
        })
        return Response.json({ ...payload, data: { ...payload.data, providers } })
      })
    }
  ` })
  const captures: Array<{ name: string, bytes: Buffer }> = []
  async function capture(name: string, clip: { x: number, y: number, width: number, height: number }) {
    await evaluate(cdp, 'document.fonts.ready')
    const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', {
      format: 'webp', quality: 88, clip: { ...clip, scale: 1 }, captureBeyondViewport: false,
    })
    captures.push({ name, bytes: Buffer.from(shot.data, 'base64') })
  }
  try {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    for (const scheme of ['light', 'dark']) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }],
      })
      const composer = await auditPage(`${site}/composer`, { cdp })
      for (const error of [...composer.errors, ...composer.failed]) fail('composer', scheme, error)
      await waitUntil('Sample Composer channels', () => evaluate<boolean>(cdp, `
        document.querySelector('[data-provider-toggle="bluesky:101"]')?.getAttribute('aria-pressed') === 'true'
          && document.querySelector('[data-provider-toggle="linkedin:102"]')?.getAttribute('aria-pressed') === 'true'`), 10_000)
      await evaluate(cdp, `(() => {
        const blog = document.querySelector('[data-provider-toggle=blog]')
        if (blog?.getAttribute('aria-pressed') === 'true') blog.click()
        const field = document.querySelector('[data-bluesky-text]')
        field.value = ${JSON.stringify(draft)}
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await waitUntil('Rendered Composer draft and link preview', () => evaluate<boolean>(cdp, `
        document.querySelector('[data-network-preview=bluesky] [data-link-preview]')?.textContent.includes('Northstar Field Notes')
          && document.querySelector('[data-network-preview=linkedin] [data-preview-copy]')?.textContent.includes('spring field guide')
          && document.documentElement.classList.contains('dark') === ${scheme === 'dark'}`), 10_000)
      await capture(`composer-${scheme}.webp`, { x: 0, y: 0, width: 1280, height: 685 })

      const queue = await auditPage(`${site}/queue`, { cdp })
      for (const error of [...queue.errors, ...queue.failed]) fail('queue', scheme, error)
      await waitUntil('The photographed Queue has its three scheduled posts', () => evaluate<boolean>(cdp, `
        [...document.querySelectorAll('#queue-results article')].filter(row => row.getClientRects().length).length === 3
          && document.querySelector('#queue-results').textContent.includes('spring field guide')
          && !document.querySelector('[data-scheduler-warning]').getClientRects().length`), 10_000)
      const origin = await evaluate<{ x: number, y: number }>(cdp, `(() => {
        const screen = document.querySelector('[data-testid=queue-page]').getBoundingClientRect()
        return { x: Math.floor(screen.x) - 12, y: Math.floor(screen.y) - 10 }
      })()`)
      await capture(`queue-${scheme}.webp`, { ...origin, width: 985, height: 680 })
    }
    if (failures.length) return
    mkdirSync(productImages, { recursive: true })
    for (const { name, bytes } of captures) writeFileSync(join(productImages, name), bytes)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

async function checkSpanishInbox(cdp: Cdp): Promise<void> {
  const fixture = new Database(database)
  try {
    const identity = fixture.query(`INSERT INTO social_identities (uuid, provider, handle, auth_status)
      VALUES (?, 'bluesky', 'bandeja.example', 'missing') RETURNING id`).get(crypto.randomUUID()) as { id: number }
    const conversation = fixture.query(`INSERT INTO dm_conversations (uuid, social_identity_id, provider, remote_id, participant_handle, last_message_at, last_message_preview, unread_count)
      VALUES (?, ?, 'bluesky', 'inbox-es-dm', 'autora.example', datetime('now', '-3 minutes'), 'Hola desde Bluesky', 1) RETURNING id`)
      .get(crypto.randomUUID(), identity.id) as { id: number }
    fixture.query(`INSERT INTO dm_messages (uuid, dm_conversation_id, provider, remote_id, direction, author_handle, body, sent_at)
      VALUES (?, ?, 'bluesky', 'inbox-es-message', 'incoming', 'autora.example', 'Hola desde Bluesky', datetime('now', '-3 minutes'))`)
      .run(crypto.randomUUID(), conversation.id)
    fixture.query(`INSERT INTO inbox_mentions (uuid, social_identity_id, remote_id, kind, author, body, url, posted_at)
      VALUES (?, ?, 'inbox-es-mention', 'mention', 'autora.example', 'Una mención pública', ?, datetime('now', '-3 minutes'))`)
      .run(crypto.randomUUID(), identity.id, 'https://bsky.app/profile/autora.example/post/abc')
  }
  finally {
    fixture.close()
  }

  const report = await auditPage(`${site}/inbox`, { cdp })
  for (const error of report.errors) fail('inbox', 'Spanish', error)
  for (const request of report.failed) fail('inbox', 'Spanish', request)
  const inbox = "document.querySelector('[data-testid=inbox-page][lang=es]')"
  const conversation = `[...${inbox}?.querySelectorAll('aside button') || []].find(button => button.innerText.includes('autora.example'))`
  await waitUntil('Spanish Inbox loads the unread conversation and date', () => evaluate<boolean>(cdp, `
    document.title === 'Postline - Bandeja de entrada'
      && ${inbox}?.querySelector('h1')?.textContent === 'Bandeja de entrada'
      && ${inbox}?.querySelector('select[aria-label="Red"] option')?.textContent === 'Todas las redes'
      && ${inbox}?.innerText.includes('1 conversación · 1 sin leer')
      && ${conversation}?.querySelector('time')?.textContent.startsWith('hace ')
  `), 5_000)
  await evaluate(cdp, `${conversation}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish Inbox opens and marks the conversation read', () => evaluate<boolean>(cdp, `
    ${inbox}?.innerText.includes('1 conversación · 0 sin leer')
      && ${inbox}?.querySelector('[data-inbox-thread] article p')?.textContent === 'Hola desde Bluesky'
      && ${inbox}?.querySelector('textarea[aria-label="Responder"]')?.placeholder === 'Escribe una respuesta…'
  `), 5_000)

  const sections = `${inbox}.querySelector('[role=group][aria-label="Secciones de la bandeja de entrada"]')`
  const publicInbox = "document.querySelector('[data-testid=public-inbox]')"
  await evaluate(cdp, `${sections}.querySelectorAll('button')[1].focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish Inbox loads the public mention', () => evaluate<boolean>(cdp, `
    ${publicInbox}?.querySelector('h2')?.textContent === 'Respuestas y menciones'
      && ${publicInbox}?.querySelector('article')?.innerText.includes('Mención')
      && ${publicInbox}?.querySelector('article p')?.textContent === 'Una mención pública'
  `), 5_000)
  await evaluate(cdp, `${publicInbox}.querySelector('[data-open-public-reply]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The public reply dialog has Spanish labels', () => evaluate<boolean>(cdp, `
    ${publicInbox}?.querySelector('dialog[open] h2')?.textContent === 'Respuesta pública'
      && ${publicInbox}?.querySelector('dialog[open] label')?.innerText.trim() === 'Texto de la respuesta'
  `), 5_000)
  await pressKey(cdp, 'Escape', 27)
  await waitUntil('Escape closes the public reply dialog', () => evaluate<boolean>(cdp, `!${publicInbox}?.querySelector('dialog[open]')`), 5_000)
}

async function checkSpanishListening(cdp: Cdp): Promise<void> {
  const fixture = new Database(database)
  try {
    const monitor = fixture.query(`INSERT INTO keyword_monitors (uuid, name, keywords, providers, last_checked_at)
      VALUES (?, 'Marca de prueba', '["Postline"]', '["bluesky"]', datetime('now', '-3 minutes')) RETURNING id`)
      .get(crypto.randomUUID()) as { id: number }
    fixture.query(`INSERT INTO keyword_mentions (uuid, keyword_monitor_id, provider, remote_uri, url, author_handle, body, matched_keywords, posted_at)
      VALUES (?, ?, 'bluesky', 'at://did:plc:fixture/app.bsky.feed.post/es-mention', ?, 'autora.example', 'Una mención de Postline', '["Postline"]', datetime('now', '-3 minutes'))`)
      .run(crypto.randomUUID(), monitor.id, 'https://bsky.app/profile/autora.example/post/es-mention')
  }
  finally {
    fixture.close()
  }

  const report = await auditPage(`${site}/listening`, { cdp })
  for (const error of report.errors) fail('listening', 'Spanish', error)
  for (const request of report.failed) fail('listening', 'Spanish', request)
  const listening = "document.querySelector('[data-testid=listening-page][lang=es]')"
  const mentions = `${listening}?.querySelector('[aria-label="Menciones de palabras clave"]')`
  await waitUntil('Spanish Listening shows the mention, watch count, and last check', () => evaluate<boolean>(cdp, `
    document.title === 'Postline - Escucha'
      && ${listening}?.querySelector('h1')?.textContent === 'Escucha social'
      && ${listening}?.innerText.includes('1 regla activa · 1 sin leer · Última búsqueda: hace ')
      && ${mentions}?.innerText.includes('1 mención, 1 sin leer')
      && ${mentions}?.querySelector('select[aria-label="Regla"] option')?.textContent === 'Todas las reglas'
      && ${mentions}?.querySelector('article a[aria-label="Abrir mención"]')?.getClientRects().length > 0
  `), 5_000)
  const watch = `[...${listening}.querySelectorAll('aside button')].find(button => button.innerText.includes('Marca de prueba'))`
  await evaluate(cdp, `${watch}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The Spanish watch opens in the editor from the keyboard', () => evaluate<boolean>(cdp, `
    ${listening}?.querySelector('aside h2')?.textContent === 'Editar regla de escucha'
      && ${listening}?.querySelector('input[placeholder="Menciones de la marca"]')?.value === 'Marca de prueba'
      && [...${listening}.querySelectorAll('aside button')].some(button => button.innerText === 'Eliminar' && button.getClientRects().length)
  `), 5_000)
  const markRead = `[...${mentions}.querySelectorAll('button')].find(button => button.textContent.trim() === 'Marcar todo como leído')`
  await evaluate(cdp, `${markRead}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish Listening records the mention as read', () => evaluate<boolean>(cdp, `(async () => {
    const payload = await fetch('/api/postline/listening').then(response => response.json())
    return ${mentions}?.innerText.includes('1 mención, 0 sin leer')
      && payload.data?.mentions?.some(mention => mention.body === 'Una mención de Postline' && mention.status === 'read')
  })()`), 5_000)
}

async function checkSpanishAnalytics(cdp: Cdp): Promise<void> {
  const report = await auditPage(`${site}/analytics`, { cdp })
  for (const error of report.errors) fail('analytics', 'Spanish', error)
  for (const request of report.failed) fail('analytics', 'Spanish', request)
  const analytics = "document.querySelector('[data-testid=analytics-page][lang=es]')"
  const range = `${analytics}?.querySelector('select')`
  const dates = `${analytics}?.querySelector('details tbody')`
  await waitUntil('Spanish Analytics displays the Blog post, date options, and data table', () => evaluate<boolean>(cdp, `
    document.title === 'Postline - Estadísticas'
      && ${analytics}?.querySelector('h1')?.textContent === 'Estadísticas de publicación'
      && ${range}?.selectedOptions[0]?.textContent === 'Últimos 30 días'
      && ${analytics}?.querySelector('[data-analytics-total]')?.textContent === '1'
      && ${analytics}?.querySelector('[data-analytics-engagement]')?.textContent === 'No disponible'
      && ${dates}?.querySelector('tr:last-child td')?.textContent === new Intl.DateTimeFormat('es', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date())
  `), 5_000)
  const fixture = new Database(database)
  try {
    fixture.query(`INSERT INTO post_targets (uuid, post_id, provider, status, created_at, metrics)
      SELECT ?, id, 'bluesky', 'published', published_at, '{"likes":1,"replies":2}' FROM posts WHERE status='published'`)
      .run(crypto.randomUUID())
  }
  finally {
    fixture.close()
  }
  await evaluate(cdp, `
    const select = ${range}
    select.value = '7'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  `)
  try {
    await waitUntil('Spanish Analytics narrows the range and shows measured interactions', () => evaluate<boolean>(cdp, `
      ${range}?.selectedOptions[0]?.textContent === 'Últimos 7 días'
        && ${dates}?.querySelectorAll('tr').length === 7
        && ${analytics}?.querySelector('[data-analytics-engagement]')?.textContent === '3'
        && ${analytics}?.querySelector('[data-analytics-engagement-trend]')?.textContent === '1 Me gusta o reacción · 2 respuestas'
    `), 5_000)
  }
  catch (error) {
    const state = await evaluate<unknown>(cdp, `({
      range: ${range}?.value, rows: ${dates}?.querySelectorAll('tr').length,
      count: ${analytics}?.querySelector('[data-analytics-engagement]')?.textContent,
      metrics: ${analytics}?.querySelector('[data-analytics-engagement-trend]')?.textContent,
    })`)
    throw new Error(`${String(error)} (${JSON.stringify(state)})`)
  }

  const links = `${analytics}.querySelector('[data-tracked-links]')`
  await evaluate(cdp, `${links}.querySelector('input[name=destination]').focus()`)
  await cdp.send('Input.insertText', { text: 'https://example.org/articulo' })
  await evaluate(cdp, `${links}.querySelector('input[name=source]').focus()`)
  await cdp.send('Input.insertText', { text: 'boletin' })
  await evaluate(cdp, `${links}.querySelector('button[value=tag]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish tracked links builds the tagged URL', () => evaluate<boolean>(cdp, `
    ${links}.querySelector('h2')?.textContent === 'Enlaces con seguimiento'
      && ${links}.querySelector('[data-tracked-link-result]')?.value === 'https://example.org/articulo?utm_source=boletin'
      && ${links}.querySelector('[role=status]')?.innerText === 'El enlace está listo para copiar.'
  `), 5_000)
}

async function checkSpanishChannels(cdp: Cdp): Promise<void> {
  const report = await auditPage(`${site}/accounts?twitter=tested`, { cdp })
  for (const error of report.errors) fail('accounts', 'Spanish', error)
  for (const request of report.failed) fail('accounts', 'Spanish', request)
  await waitUntil('Spanish publishing channels, connection feedback, and Blog card', () => evaluate<boolean>(cdp, `
    document.title === 'Postline - Configuración - Canales'
      && document.querySelector('[data-testid="accounts-page"][lang="es"] h1')?.textContent === 'Conecta tus canales'
      && document.querySelector('[data-testid="accounts-page"] header')?.innerText.includes('canales de publicación')
      && document.querySelector('[data-channel="blog"]')?.innerText.includes('Incluido en Postline')
      && document.querySelector('[data-testid="accounts-page"] [role=status]')?.innerText.includes('Se verificó el inicio de sesión en X.')
  `), 5_000)

  const browserSessionError = await evaluate<{ status: number, message: string }>(cdp, `(async () => {
    const response = await fetch('/api/postline/twitter/browser-session')
    const result = await response.json()
    return { status: response.status, message: result.error }
  })()`)
  if (browserSessionError.status !== 404
    || browserSessionError.message !== 'Las sesiones de X en el navegador están disponibles en la app de Postline para Mac.')
    throw new Error('The X browser session API did not return its Spanish desktop-only message.')

  await evaluate(cdp, `document.querySelector('[data-network-app=twitter] summary').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish X developer app form reveals its localized labels', () => evaluate<boolean>(cdp, `
    document.querySelector('[data-network-app=twitter]')?.open
      && document.querySelector('[data-network-app=twitter] [data-app-client-id]')?.closest('label')?.innerText === 'ID de cliente'
      && document.querySelector('[data-network-app=twitter] [data-app-client-secret]')?.placeholder === 'Pega el secreto de cliente'
      && document.querySelector('[data-network-app=twitter] [data-app-direct-messages]')?.closest('label')?.innerText.includes('mensajes directos de pago')
      && document.querySelector('[data-network-app=twitter] ol')?.lang === 'en'
  `), 5_000)

  await evaluate(cdp, `document.querySelector('[data-purge-card] summary').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await evaluate(cdp, `document.querySelector('[data-purge-preview]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish cleanup preview uses the workspace result and keeps deletion locked', () => evaluate<boolean>(cdp, `
    document.querySelector('[data-purge-summary]')?.innerText === 'Se encontraron 0 publicaciones.'
      && document.querySelector('[data-purge-phrase]')?.innerText === 'DELETE 0 POSTS'
      && document.querySelector('[data-purge-run]')?.disabled === true
      && document.querySelector('[data-purge-hint]')?.innerText === 'La vista previa no encontró publicaciones para eliminar.'
  `), 5_000)
}

async function checkSpanishCampaigns(cdp: Cdp): Promise<void> {
  const report = await auditPage(`${site}/campaigns`, { cdp })
  for (const error of report.errors) fail('campaigns', 'Spanish', error)
  for (const request of report.failed) fail('campaigns', 'Spanish', request)
  const page = `document.querySelector('[data-testid="campaigns-page"][lang="es"]')`
  const create = `[...${page}.querySelectorAll('button')].find(button => button.textContent.trim() === 'Crear una campaña')`
  await waitUntil('The Spanish Campaigns empty state offers creation', () => evaluate<boolean>(cdp, `
    document.title === 'Postline - Campañas'
      && ${page}?.querySelector('h1')?.textContent === 'Campañas'
      && Boolean((${create})?.getClientRects().length)
  `), 5_000)
  await evaluate(cdp, `(${create}).focus()`)
  await pressKey(cdp, 'Enter', 13)
  const input = (placeholder: string) => `${page}.querySelector('[placeholder=' + ${JSON.stringify(JSON.stringify(placeholder))} + ']')`
  const name = input('Lanzamiento de otoño')
  const goal = input('¿Qué quieres lograr con esta campaña?')
  await waitUntil('The Spanish campaign brief is ready to edit', () => evaluate<boolean>(cdp, `Boolean(${name}?.getClientRects().length)`), 5_000)
  await evaluate(cdp, `${name}.focus()`)
  await cdp.send('Input.insertText', { text: 'Campaña de prueba' })
  await evaluate(cdp, `${goal}.focus()`)
  await cdp.send('Input.insertText', { text: 'Explicar el lanzamiento' })
  await evaluate(cdp, `${name}.form.querySelector('button[type=submit]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  const plan = `${page}.querySelector('[aria-label="Plan de campaña"]')`
  const add = `${plan}.querySelector('[aria-current=date]')?.parentElement.querySelector('button')`
  await waitUntil('The saved campaign shows the Spanish calendar and action names', () => evaluate<boolean>(cdp, `
    ${page}.querySelector('#campaign-picker option:checked')?.textContent === 'Campaña de prueba'
      && [...${page}.querySelectorAll('dt')].some(label => label.innerText === 'Periodo')
      && ${plan}?.querySelector('[aria-label="Seis semanas anteriores"]')?.getClientRects().length > 0
      && ${add}?.getAttribute('aria-label')?.startsWith('Añadir una publicación el ')
      && ${page}.querySelector('[aria-label="Herramientas de campaña"]')?.innerText.includes('Asistente de campaña')
  `), 5_000)
  await evaluate(cdp, `(${add}).focus()`)
  await pressKey(cdp, 'Enter', 13)
  const postTitle = input('Primer anuncio')
  const postBody = input('Escribe la publicación…')
  await waitUntil('The Spanish planned post editor opens from the calendar', () => evaluate<boolean>(cdp, `
    Boolean(${postTitle}?.getClientRects().length)
      && ${page}.querySelector('option[value="follow-up"]')?.textContent.trim() === 'Seguimiento'
  `), 5_000)
  await evaluate(cdp, `${postTitle}.focus()`)
  await cdp.send('Input.insertText', { text: 'Anuncio de prueba' })
  await evaluate(cdp, `${postBody}.focus()`)
  await cdp.send('Input.insertText', { text: 'Una publicación para el plan.' })
  await evaluate(cdp, `${postTitle}.form.querySelector('button[type=submit]').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The Spanish calendar shows the saved planned post', () => evaluate<boolean>(cdp, `
    [...${plan}.querySelectorAll('article')].some(item => item.innerText.includes('Anuncio de prueba')
      && item.innerText.includes('Historia') && item.innerText.includes('idea'))
  `), 5_000)
}

async function checkSpanishSettings(cdp: Cdp): Promise<void> {
  const report = await auditPage(`${site}/settings`, { cdp })
  for (const error of report.errors) fail('settings', 'Spanish', error)
  for (const request of report.failed) fail('settings', 'Spanish', request)
  const settings = `document.querySelector('[data-testid="settings-page"][lang="es"]')`
  const general = `${settings}.querySelector('[data-settings-pane=general]')`
  const workspaceName = `${general}.querySelector('[data-setting=workspace-name] input')`
  const tab = (pane: string) => `${settings}.querySelector('[data-settings-item=${pane}]')`
  await waitUntil('Spanish Settings opens General with the localized search and controls', () => evaluate<boolean>(cdp, `
    document.title === 'Postline - Configuración'
      && ${settings}.querySelector('[data-settings-search-input]')?.placeholder === 'Buscar en la configuración'
      && ${settings}.querySelector('[data-settings-back]')?.innerText.trim() === 'Volver a Postline'
      && ${general}?.innerText.includes('Zona horaria')
      && Boolean(${workspaceName}?.value)
  `), 5_000)

  const save = `[...${general}.querySelectorAll('button')].find(button => button.textContent.trim() === 'Guardar')`
  await evaluate(cdp, `${workspaceName}.focus(); ${workspaceName}.select()`)
  await cdp.send('Input.insertText', { text: 'Taller de publicaciones' })
  await waitUntil('The Spanish workspace preferences can be saved', () => evaluate<boolean>(cdp, `(${save})?.disabled === false`), 5_000)
  await evaluate(cdp, `(${save}).focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Saving the workspace displays the Spanish status and persists the name', () => evaluate<boolean>(cdp, `(async () => {
    const response = await fetch('/api/postline/settings/workspace').then(value => value.json())
    return response.data?.workspaceName === 'Taller de publicaciones'
      && ${general}.querySelector('[data-workspace-message]')?.innerText === 'Cambios guardados.'
  })()`), 5_000)

  await evaluate(cdp, `${tab('appearance')}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The appearance radio group has Spanish captions', () => evaluate<boolean>(cdp, `
    ${settings}.querySelector('[data-settings-pane=appearance] [role=radiogroup]')?.innerText.includes('Automática')
      && ${tab('appearance')}.getAttribute('aria-selected') === 'true'
  `), 5_000)

  await evaluate(cdp, `${tab('ai')}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The Spanish AI settings show the provider and planner status', () => evaluate<boolean>(cdp, `
    ${tab('ai')}.getAttribute('aria-selected') === 'true'
      && ${settings}.querySelector('[data-setting=ai-provider]')?.innerText.includes('Proveedor')
      && ${settings}.querySelector('[data-setting=ai-active]')?.innerText.includes('Planificador activo')
      && ${settings}.querySelector('[data-ai-active]')?.textContent.trim() !== '—'
  `), 5_000)

  await evaluate(cdp, `${tab('composer')}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  const autosave = `${settings}.querySelector('[data-setting=auto-save] button[role=switch]')`
  await waitUntil('Spanish Composer preferences expose the autosave switch', () => evaluate<boolean>(cdp, `
    Boolean(${autosave}?.getClientRects().length)
      && ${settings}.querySelector('[data-setting=auto-save]')?.innerText.includes('Guardar borradores automáticamente')
  `), 5_000)
  const before = await evaluate<string>(cdp, `${autosave}.getAttribute('aria-checked')`)
  await evaluate(cdp, `${autosave}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The autosave switch changes from the keyboard', () => evaluate<boolean>(cdp, `
    ${autosave}.getAttribute('aria-checked') !== ${JSON.stringify(before)}
  `), 5_000)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The autosave switch restores the original choice', () => evaluate<boolean>(cdp, `
    ${autosave}.getAttribute('aria-checked') === ${JSON.stringify(before)}
  `), 5_000)

  await evaluate(cdp, `${tab('deletion')}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  const preview = `[...${settings}.querySelectorAll('[data-settings-pane=deletion] button')].find(button =>
    button.textContent.trim() === 'Ver qué publicaciones se eliminarían')`
  await waitUntil('Spanish retention preview is ready', () => evaluate<boolean>(cdp, `(${preview})?.disabled === false`), 5_000)
  await evaluate(cdp, `(${preview}).focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish retention preview reports zero matches and keeps deletion disabled', () => evaluate<boolean>(cdp, `(async () => {
    const response = await fetch('/api/postline/settings/retention').then(value => value.json())
    return response.data?.settings.enabled === false
      && ${settings}.querySelector('[data-retention-message]')?.textContent.trim()
        === 'Hay 0 publicaciones con más de 7 días. No se eliminó nada.'
  })()`), 5_000)

  await evaluate(cdp, `${tab('about')}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish About shows the Postline version in the browser', () => evaluate<boolean>(cdp, `
    ${tab('about')}.getAttribute('aria-selected') === 'true'
      && ${settings}.querySelector('[data-setting=desktop-version]')?.innerText.includes('Versión de Postline')
      && ${settings}.querySelector('[data-setting=desktop-version]')?.innerText.match(/[0-9]+[.][0-9]+[.][0-9]+/)
  `), 5_000)

  await evaluate(cdp, `${tab('account')}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  const enable = `[...${settings}.querySelectorAll('[data-setting=two-factor] button')].find(button => button.textContent.trim() === 'Activar…')`
  await waitUntil('Spanish Account shows passkeys and two-factor controls', () => evaluate<boolean>(cdp, `
    ${tab('account')}.getAttribute('aria-selected') === 'true'
      && ${settings}.querySelector('[data-passkey-list]')?.innerText.includes('Aún no hay llaves de acceso.')
      && (${enable})?.disabled === false
  `), 5_000)
  await evaluate(cdp, `(${enable}).focus()`)
  await pressKey(cdp, 'Enter', 13)
  const securitySetup = `${settings}.querySelector('[data-two-factor-setup]')`
  await waitUntil('The local authenticator setup shows Spanish instructions and a named QR code', () => evaluate<boolean>(cdp, `
    Boolean(${securitySetup}?.getClientRects().length)
      && ${securitySetup}.querySelector('img')?.alt === 'Código QR para tu aplicación de autenticación'
      && ${securitySetup}.innerText.includes('Escanea el código con tu aplicación de autenticación')
  `), 5_000)
  await evaluate(cdp, `[...${securitySetup}.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancelar').focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Cancelling the Spanish authenticator setup leaves two-factor off', () => evaluate<boolean>(cdp, `(async () => {
    const result = await fetch('/api/auth/two-factor').then(response => response.json())
    return !${securitySetup}?.getClientRects().length && result.data?.twoFactor === false
  })()`), 5_000)

  await evaluate(cdp, `${tab('data')}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  const data = `${settings}.querySelector('[data-settings-pane=data]')`
  const phrase = `${data}.querySelector('[data-delete-phrase] input')`
  const deleteButton = `[...${data}.querySelectorAll('button')].find(button => button.textContent.trim() === 'Borrar todos los datos')`
  await waitUntil('Spanish Data shows the export and locks deletion behind the confirmation phrase', () => evaluate<boolean>(cdp, `
    ${data}.querySelector('a[download]')?.textContent.trim() === 'Exportar…'
      && ${data}.innerText.includes('Elegir un archivo…')
      && (${deleteButton})?.disabled === true
  `), 5_000)
  await evaluate(cdp, `(async () => {
    const archive = await fetch(${data}.querySelector('a[download]').href)
    if (!archive.ok) throw new Error('Could not export the browser fixture')
    const transfer = new DataTransfer()
    transfer.items.add(new File([await archive.blob()], 'postline-fixture.json', { type: 'application/json' }))
    const input = ${data}.querySelector('input[type=file]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  const archiveMessage = `${data}.querySelector('[data-workspace-data-message]')`
  await waitUntil('The real archive reimport displays a result', () => evaluate<boolean>(cdp, `Boolean(${archiveMessage}?.textContent.trim())`), 10_000)
  const importSummary = await evaluate<string>(cdp, `${archiveMessage}.textContent.trim()`)
  if (!importSummary.includes('Se importaron 0 publicaciones') || !/Se conserv(?:ó|aron) [1-9][0-9]* elementos? existentes?/.test(importSummary))
    throw new Error(`Expected the Spanish archive summary for existing records. Received: ${importSummary}`)
  await evaluate(cdp, `${phrase}.focus()`)
  await cdp.send('Input.insertText', { text: 'DELETE EVERYTHING' })
  await waitUntil('The confirmation phrase makes the Spanish delete button available', () => evaluate<boolean>(cdp, `(${deleteButton})?.disabled === false`), 5_000)
  await evaluate(cdp, `(${deleteButton}).focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('The Spanish deletion dialog initially focuses Cancel', () => evaluate<boolean>(cdp, `
    document.activeElement?.textContent === 'Cancelar'
      && document.activeElement.closest('[role=alertdialog]')?.textContent.includes('Esta acción es irreversible.')
  `), 5_000)
  await pressKey(cdp, 'Escape', 27)
  await waitUntil('Cancel returns to the workspace data controls', () => evaluate<boolean>(cdp, `!document.querySelector('[role=alertdialog]')`), 5_000)

  await evaluate(cdp, `${tab('notifications')}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  const activity = `${settings}.querySelector('[data-setting=activity-alerts] button')`
  await waitUntil('Notifications shows the Spanish instructions and live mail status', () => evaluate<boolean>(cdp, `
    ${tab('notifications')}.getAttribute('aria-selected') === 'true'
      && ${activity}?.innerText.trim() === 'Abrir Actividad'
      && document.getElementById('settings-row-mail-status-description')?.innerText.includes('El correo queda en el registro')
  `), 5_000)
  await evaluate(cdp, `${activity}.focus()`)
  await pressKey(cdp, 'Enter', 13)
  await waitUntil('Spanish Settings opens the Spanish Activity workspace', () => evaluate<boolean>(cdp, `
    location.pathname === '/activity' && Boolean(document.querySelector('[data-postline-page=activity][lang=es]'))
  `), 5_000)
}

async function checkSpanishWorkspace(cdp: Cdp): Promise<void> {
  const fixture = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: `
    const actualFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input, location.href).pathname
      if (path === '/api/postline/bluesky/timeline') {
        return Response.json({ ok: true, data: { connected: true, items: [{
          authorHandle: 'alice.example', authorName: 'Alice Example', body: 'Mi primera publicación.',
          postedAt: new Date(Date.now() - 10 * 60_000).toISOString(), postUrl: 'https://bsky.app/profile/alice.example/post/first',
        }] } })
      }
      const response = await actualFetch(input, init)
      if (path !== '/api/postline/bootstrap' || !response.ok) return response
      const payload = await response.json()
      return Response.json({ ...payload, data: { ...payload.data, unread: { inbox: 1, listening: 2 } } })
    }
  ` })
  try {
    const seeded = await evaluate<number>(cdp, `(async () => {
      const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      const body = new URLSearchParams({ title: 'Publicación de prueba', text: 'Publicación de prueba', providers: 'blog', scheduled_at: future })
      return (await fetch('/api/postline/queue', { method: 'POST', body })).status
    })()`)
    if (seeded < 200 || seeded >= 300) throw new Error(`Could not schedule the Spanish date-picker fixture (HTTP ${seeded}).`)
    const report = await auditPage(`${site}/queue`, { cdp })
    for (const error of report.errors) fail('queue', 'Spanish', error)
    for (const request of report.failed) fail('queue', 'Spanish', request)
    await waitUntil('Spanish navigation, headings, and unread labels', () => evaluate<boolean>(cdp, `
      document.querySelector('h1[lang="es"]')?.textContent === 'Publicaciones programadas'
        && document.querySelector('[data-testid=postline-nav] a[href="/queue"]')?.closest('[lang]')?.lang === 'es'
        && document.querySelector('[data-testid=postline-nav] a[href="/inbox"]')?.textContent.includes('1 mensaje sin leer')
        && document.querySelector('[data-testid=postline-nav] a[href="/listening"]')?.textContent.includes('2 menciones sin leer')
        && document.querySelector('[data-testid="queue-page"][lang="es"] input#queue-search')?.placeholder === 'Buscar en todas las publicaciones'
        && document.querySelector('[data-queue-tab][aria-selected="true"] span')?.textContent === 'Programadas'
    `), 5_000)

    await waitUntil('Spanish Queue panels', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-posting-slots] summary')?.textContent === 'Horarios de publicación'
        && document.querySelector('[data-draft-feeds] summary')?.textContent === 'Fuentes de borradores'
        && document.querySelector('[data-recurring-posts] summary')?.textContent === 'Publicaciones recurrentes'
    `), 5_000)
    await evaluate(cdp, "document.querySelector('[data-draft-feeds] summary').click()")
    await waitUntil('Spanish draft-feed form and empty state', () => evaluate<boolean>(cdp, `
      Boolean(document.querySelector('[data-draft-feed-form] button')?.textContent === 'Añadir fuente'
        && [...document.querySelectorAll('[data-draft-feeds] p')].some(node =>
          node.textContent === 'Aún no hay fuentes de borradores.' && node.getClientRects().length))
    `), 5_000)
    await evaluate(cdp, "document.querySelector('[data-draft-feeds] summary').click()")

    const select = `[...document.querySelectorAll('button[aria-pressed]')].find(button => button.textContent.trim() === 'Seleccionar publicaciones')`
    await waitUntil('Spanish scheduled post can be selected', () => evaluate<boolean>(cdp, `
      ${select} && !${select}.disabled && document.getElementById('queue-results')?.innerText.includes('Publicación de prueba')
    `), 5_000)
    await evaluate(cdp, `${select}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const picker = `document.querySelector('[data-schedule-day-details]')`
    const summary = `${picker}?.querySelector('summary')`
    await waitUntil('Spanish date picker is available', () => evaluate<boolean>(cdp, `Boolean(${summary}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${summary}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Spanish date picker exposes localized month buttons', () => evaluate<boolean>(cdp, `
      ${picker}?.open && Boolean(${picker}.querySelector('button[aria-label="Mes anterior"]')?.getClientRects().length
        && ${picker}.querySelector('button[aria-label="Mes siguiente"]')?.getClientRects().length)
    `), 5_000)
    await pressKey(cdp, 'Escape', 27)
    await waitUntil('Escape closes the date picker and restores focus', () => evaluate<boolean>(cdp, `
      !${picker}.open && document.activeElement === ${summary}
    `), 5_000)
    await evaluate(cdp, `${select}.focus()`)
    await pressKey(cdp, 'Enter', 13)

    await evaluate(cdp, "document.querySelector('[data-queue-tab][aria-selected=true]').focus()")
    await pressKey(cdp, 'ArrowRight', 39)
    await waitUntil('Spanish Queue tabs work with the keyboard', () => evaluate<boolean>(cdp, `
      document.activeElement?.getAttribute('aria-selected') === 'true'
        && document.activeElement?.querySelector('span')?.textContent === 'Borradores'
    `), 5_000)

    const calendar = "document.querySelector('[role=group][aria-label=\"Vista de la cola\"] button:nth-of-type(2)')"
    await evaluate(cdp, `${calendar}?.click()`)
    await waitUntil('Spanish calendar controls and abbreviations', () => evaluate<boolean>(cdp, `
      Boolean(document.querySelector('[aria-label="Calendario de la cola"]')?.getClientRects().length
        && document.querySelector('[aria-label="Mes anterior"]')
        && document.querySelector('[aria-label="Mes siguiente"]')
        && document.querySelector('[aria-label="Calendario de la cola"]').textContent.includes('lun.'))
    `), 5_000)

    await pressKey(cdp, 'k', 75, 2)
    await waitUntil('Spanish command palette opens with the keyboard', () => evaluate<boolean>(cdp, `
      document.querySelector('#workspace-commands[open] h2')?.textContent === 'Paleta de comandos'
        && document.activeElement?.getAttribute('aria-label') === 'Buscar comandos'
    `), 5_000)
    await cdp.send('Input.insertText', { text: 'cola' })
    await waitUntil('Spanish navigation result', () => evaluate<boolean>(cdp, `
      document.querySelector('#workspace-commands [role=option][lang=es]')?.textContent.includes('Ir a la vista')
    `), 5_000)
    await pressKey(cdp, 'Escape', 27)

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
    const mobile = await auditPage(`${site}/queue`, { cdp })
    for (const error of mobile.errors) fail('queue', 'Spanish mobile', error)
    for (const request of mobile.failed) fail('queue', 'Spanish mobile', request)
    const more = "document.querySelector('[data-postline-mobile-nav] button')"
    await waitUntil('Spanish mobile navigation', () => evaluate<boolean>(cdp, `
      ${more}?.innerText === 'Más' && ${more}.getAttribute('aria-expanded') === 'false'
        && document.documentElement.scrollWidth === window.innerWidth
    `), 5_000)
    await evaluate(cdp, `${more}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Spanish mobile menu', () => evaluate<boolean>(cdp, `
      document.querySelector('#workspace-more[open] h2')?.textContent === 'Más vistas'
    `), 5_000)

    await cdp.send('Emulation.clearDeviceMetricsOverride')
    const activity = await auditPage(`${site}/activity`, { cdp })
    for (const error of activity.errors) fail('activity', 'Spanish', error)
    for (const request of activity.failed) fail('activity', 'Spanish', request)
    await waitUntil('Spanish Activity heading and Blog send', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-testid="activity-page"][lang="es"] h1')?.textContent === 'Actividad'
        && document.title === 'Postline - Actividad'
        && document.querySelector('[aria-label="Envíos"] [data-activity-row]')?.innerText.includes('Enviado')
        && document.querySelector('[aria-label="Envíos"] [data-activity-row]')?.innerText.includes('Blog')
    `), 5_000)
    await waitUntil('Spanish Activity scheduler status', () => evaluate<boolean>(cdp, `
      document.querySelector('[aria-label="Tareas en segundo plano"]')?.innerText.includes('Aún no se ha ejecutado ninguna tarea.')
        && document.querySelector('[data-scheduler-warning]')?.innerText.includes('Inícialo con ./buddy schedule:run.')
    `), 5_000)
    await evaluate(cdp, `
      [...document.querySelectorAll('[role="group"][aria-label="Estado del envío"] button')].find(button =>
        button.innerText.trim() === 'Fallido').focus()
    `)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Spanish Activity failed-sends keyboard filter', () => evaluate<boolean>(cdp, `
      document.activeElement?.getAttribute('aria-pressed') === 'true'
        && document.querySelector('[aria-label="Envíos"]')?.innerText.includes('No hay envíos fallidos')
    `), 5_000)

    const timeline = await auditPage(`${site}/timeline`, { cdp })
    for (const error of timeline.errors) fail('timeline', 'Spanish', error)
    for (const request of timeline.failed) fail('timeline', 'Spanish', request)
    await waitUntil('Spanish Bluesky Timeline shows the localized count and date', () => evaluate<boolean>(cdp, `
      document.title === 'Postline - Cronología'
        && document.querySelector('[data-testid="timeline-page"][lang="es"] h1')?.textContent === 'Cronología de Bluesky'
        && document.querySelector('[aria-label="Cronología de Bluesky"]')?.innerText.includes('1 publicación')
        && document.querySelector('[data-timeline-copy]')?.innerText === 'Mi primera publicación.'
        && document.querySelector('[aria-label="Abrir publicación en Bluesky"]')?.title === 'Abrir en Bluesky'
        && document.querySelector('[data-testid="timeline-page"] time')?.innerText.startsWith('hace ')
    `), 5_000)

    const writing = await auditPage(`${site}/writing`, { cdp })
    for (const error of writing.errors) fail('writing', 'Spanish', error)
    for (const request of writing.failed) fail('writing', 'Spanish', request)
    await waitUntil('Spanish Blog management shows the published post and controls', () => evaluate<boolean>(cdp, `
      document.querySelector('[data-testid="blog-page"][lang="es"] h1')?.textContent === 'Publicaciones de formato largo'
        && document.querySelector('[aria-label="Publicaciones del blog"] [data-blog-row]')?.innerText.includes('Publicada')
        && document.getElementById('import-heading')?.textContent === 'Importar publicaciones'
    `), 5_000)
    await evaluate(cdp, `(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['title,body\\nOtra entrada,Texto de prueba\\n'], 'entradas.csv', { type: 'text/csv' }))
      const input = document.querySelector('[aria-labelledby="import-heading"] input[type="file"]')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await waitUntil('Spanish Blog import preview uses the server report', () => evaluate<boolean>(cdp, `
      document.querySelector('[aria-labelledby="import-heading"] [role="status"]')?.innerText === 'Vista previa: crear 1, actualizar 0, omitir 0.'
    `), 5_000)
    await checkSpanishInbox(cdp)
    await checkSpanishListening(cdp)
    await checkSpanishAnalytics(cdp)
    await checkSpanishChannels(cdp)
    await checkSpanishCampaigns(cdp)
    await checkSpanishSettings(cdp)
    const composer = await auditPage(`${site}/composer`, { cdp })
    for (const error of composer.errors) fail('composer', 'Spanish', error)
    for (const request of composer.failed) fail('composer', 'Spanish', request)
    const editor = `document.querySelector('[data-testid="composer-page"][lang="es"]')`
    const menu = `${editor}.querySelector('[data-composer-actions] summary')`
    await waitUntil('Spanish Composer shows its heading, format, and primary action', () => evaluate<boolean>(cdp, `
      document.title === 'Postline - Redactar'
        && ${editor}.querySelector('[data-composer-heading]')?.textContent === 'Nueva publicación'
        && ${editor}.querySelector('[data-stx-segmented-control][aria-label="Formato de publicación"] [aria-label="Hilo"]')
        && ${editor}.querySelector('[data-bluesky-publish-label]')?.textContent === 'Publicar'
        && ${editor}.querySelector('#composer-preview-title')?.textContent === 'Vista previa'
    `), 5_000)
    await evaluate(cdp, `${menu}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The Spanish publishing menu opens from the keyboard', () => evaluate<boolean>(cdp, `
      ${menu}.parentElement.open && ${menu}.getAttribute('aria-label') === 'Opciones de publicación'
        && Boolean([...${menu}.parentElement.querySelectorAll('button')].find(button => button.textContent.trim() === 'Guardar borrador'))
    `), 5_000)
    const schedule = `${editor}.querySelector('[data-postline-schedule-picker] [data-date-time-trigger]')`
    await evaluate(cdp, `${schedule}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const hour = `${editor}.querySelector('[data-date-time-preset=hour]')`
    await waitUntil('Spanish Composer shows the one-hour scheduling choice', () => evaluate<boolean>(cdp, `Boolean(${hour}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${hour}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Picking a time shows the Spanish scheduled action', () => evaluate<boolean>(cdp, `
      !${menu}.parentElement.open
        && ${editor}.querySelector('[data-bluesky-publish-label]')?.textContent.startsWith('Programar para ')
    `), 5_000)
    const optionError = await evaluate<{ status: number, message: string }>(cdp, `(async () => {
      const body = new URLSearchParams({ providers: 'blog', text: 'Validación de opciones', language: 'english' })
      const response = await fetch('/api/postline/queue', { method: 'POST', body })
      return { status: response.status, message: (await response.json()).error }
    })()`)
    if (optionError.status !== 422
      || optionError.message !== '"english" no es un código de idioma que Postline reconozca, como en o pt-BR.')
      throw new Error('The Queue API did not return the Spanish validation message for the language option.')

    const blog = `${editor}.querySelector('[data-provider-toggle=blog]')`
    await waitUntil('Spanish Composer loads the Blog channel', () => evaluate<boolean>(cdp, `Boolean(${blog}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `if (${blog}.getAttribute('aria-pressed') !== 'true') ${blog}.click()`)
    const rich = `${editor}.querySelector('[data-richtext-host] [contenteditable=true]')`
    await waitUntil('The Spanish Blog editor opens', () => evaluate<boolean>(cdp, `Boolean(${rich}?.getClientRects().length)`), 10_000)
    const variants = `${editor}.querySelector('[data-variant-toggle]')`
    await evaluate(cdp, `${variants}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const variant = `${editor}.querySelector('[data-variant-action=fork][data-variant-provider=blog]')`
    await waitUntil('Spanish per-network text shows its controls and shared text status', () => evaluate<boolean>(cdp, `
      ${variants}.textContent.trim() === 'Ocultar texto por red'
        && ${variant}?.textContent.trim() === 'Personalizar'
        && ${variant}.closest('[data-variant-row]').textContent.includes('Usa el texto compartido')
    `), 5_000)
    await evaluate(cdp, `${variant}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const variantField = `${editor}.querySelector('[data-variant-input=blog]')`
    await waitUntil('The localized Blog variant is named and focused', () => evaluate<boolean>(cdp, `
      document.activeElement === ${variantField}
        && ${variantField}?.getAttribute('aria-label') === 'Texto para Blog'
    `), 5_000)
    await evaluate(cdp, `${variantField}.select()`)
    await cdp.send('Input.insertText', { text: 'Texto propio' })
    const resetVariant = `${editor}.querySelector('[data-variant-action=reset][data-variant-provider=blog]')`
    await waitUntil('The localized variant has a character count and a reset action', () => evaluate<boolean>(cdp, `
      ${resetVariant}?.textContent.trim() === 'Usar el texto compartido'
        && ${resetVariant}.closest('[data-variant-row]').textContent.includes('12 / 10000 caracteres')
    `), 5_000)
    await evaluate(cdp, `${resetVariant}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Resetting the variant restores the shared text', () => evaluate<boolean>(cdp, `!${variantField} && Boolean(${variant})`), 5_000)

    const thread = `${editor}.querySelector('[data-stx-segmented-control] button[aria-label=Hilo]')`
    await evaluate(cdp, `${thread}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const reply = `${editor}.querySelector('[data-bluesky-text][aria-label="Texto de la publicación 2"]')`
    const removeReply = `${editor}.querySelector('[data-remove-post][aria-label="Quitar la publicación 2"]')`
    await waitUntil('Spanish thread shows the second post and names its controls', () => evaluate<boolean>(cdp, `
      ${thread}.getAttribute('aria-pressed') === 'true'
        && ${reply}?.getClientRects().length > 0 && ${removeReply}?.getClientRects().length > 0
        && ${reply}.closest('[data-composer-post]').querySelector('[data-select-post]').innerText.trim() === 'Publicación 2'
    `), 5_000)
    await evaluate(cdp, `${reply}.focus()`)
    await cdp.send('Input.insertText', { text: 'Respuesta de prueba' })
    await evaluate(cdp, `${removeReply}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    const removed = "document.querySelector('[data-stx-toast-key=composer-post-removed]:not([data-stx-toast-exiting])')"
    const undo = `${removed}?.querySelector('[data-stx-toast-action]')`
    await waitUntil('Removing a Spanish thread post offers a localized Undo', () => evaluate<boolean>(cdp, `
      !${reply} && ${removed}?.textContent.includes('Se quitó la publicación 2.') && ${undo}?.textContent === 'Deshacer'
    `), 5_000)
    await evaluate(cdp, `${undo}.click()`)
    await waitUntil('Undo restores the Spanish thread post', () => evaluate<boolean>(cdp, `${reply}?.value === 'Respuesta de prueba'`), 5_000)
    await evaluate(cdp, `${removeReply}.click()`)
    await evaluate(cdp, `${editor}.querySelector('[data-stx-segmented-control] button[aria-label=Individual]').focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('Spanish Composer returns to a single post', () => evaluate<boolean>(cdp, `
      ${editor}.querySelector('[data-stx-segmented-control] button[aria-label=Individual]').getAttribute('aria-pressed') === 'true'
    `), 5_000)

    const writePost = async (text: string) => {
      await evaluate(cdp, `${rich}.focus()`)
      await cdp.send('Input.insertText', { text })
      await waitUntil('The Spanish post text reaches the editor', () => evaluate<boolean>(cdp, `
        ${rich}.textContent.includes(${JSON.stringify(text)})
          && !${editor}.querySelector('[data-bluesky-publish]').disabled
      `), 5_000)
    }
    await writePost('Borrador de verificación.')
    await pressKey(cdp, 's', 83, 4)
    await waitUntil('Saving a draft shows the Spanish confirmation', () => evaluate<boolean>(cdp, `
      document.querySelector('#stx-toast-container')?.textContent.includes('Se guardó el borrador en la cola.')
    `), 5_000)

    await writePost('Publicación programada de verificación.')
    await evaluate(cdp, `${menu}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The scheduling trigger is exposed by the publishing menu', () => evaluate<boolean>(cdp, `Boolean(${schedule}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${schedule}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The Spanish scheduling choices reopen', () => evaluate<boolean>(cdp, `Boolean(${hour}?.getClientRects().length)`), 5_000)
    await evaluate(cdp, `${hour}.focus()`)
    await pressKey(cdp, 'Enter', 13)
    await waitUntil('The scheduled action is ready', () => evaluate<boolean>(cdp, `
      ${editor}.querySelector('[data-bluesky-publish-label]')?.textContent.startsWith('Programar para ')
    `), 5_000)
    await evaluate(cdp, `${rich}.focus()`)
    await pressKey(cdp, 'Enter', 13, 4)
    await waitUntil('Scheduling a post shows the Spanish confirmation', () => evaluate<boolean>(cdp, `
      document.querySelector('#stx-toast-container')?.textContent.includes('Se programó la publicación. Puedes gestionarla en la Cola.')
    `), 5_000)

    await writePost('Publicación inmediata de verificación.')
    await pressKey(cdp, 'Enter', 13, 4)
    await waitUntil('Publishing to Blog shows the Spanish confirmation', () => evaluate<boolean>(cdp, `
      document.querySelector('#stx-toast-container')?.textContent.includes('Tu publicación está disponible en Blog.')
    `), 5_000)
  }
  finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier })
  }
}

async function checkWorkspace(cdp: Cdp): Promise<void> {
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
        if (view !== 'settings' && !await evaluate<boolean>(cdp, `(() => {
          const headers = document.querySelectorAll('#workspace-content [data-workspace-page-header]')
          return headers.length === 1 && Boolean(headers[0].querySelector('h1')?.textContent.trim())
        })()`)) fail(view, mode.name, 'the workspace page has no named shared header')
        await checkAccessibleControls(cdp, view)
        await checkWorkspaceSkipLink(cdp, view)
        if (view === 'queue') await checkQueueKeyboard(cdp)
      }
    }
  }
  await checkDesktopUpdateControls(cdp)
  await checkNotificationSettings(cdp)
  await checkWorkspaceShell(cdp)
  await checkWorkspaceCommands(cdp)
  await checkWorkspaceBootstrap(cdp)
  await checkChannels(cdp)
  await checkDesktopNetworkConsent(cdp)
  await checkPublicInbox(cdp)
  await checkTwitterDmControls(cdp)
  await checkXBrowserSession(cdp)
  await checkInstagramPagePicker(cdp)
  await checkNetworkComponents(cdp)
  await checkLocalComposerDraft(cdp)
  await checkBrowserShare(cdp)
  await checkComposerThreadDraft(cdp)
  await checkComposerPreferences(cdp)
  await checkSavedComposerText(cdp)
  await checkBrowserPasskey(cdp)
  await checkPhoneNavigation(cdp)
  await checkQueueRescheduling(cdp)
  await checkQueueCalendar(cdp)
  await checkPostingSlots(cdp)
  await checkRecurringPosts(cdp)
  await checkDraftFeeds(cdp)
  await checkCampaignScheduling(cdp)
  await checkCampaignLocalDates(cdp)
  await checkAnalytics(cdp)
  await checkTrackedLinks(cdp)
  await checkListStates(cdp)
  await checkComposerNetworkOptions(cdp)
  await checkComposerVideo(cdp)
  await checkFirstComments(cdp)
  await checkWorkspaceErasure(cdp)
}

interface FixtureServer {
  label: string
  process: OwnedProcess
  log: string
}

const servers: FixtureServer[] = []
function startServer(label: string, command: string[]): void {
  const log = join(work, `${label}.stderr.log`)
  const stderr = openSync(log, 'w')
  // Buddy's production relay gives its independently owned worker 15 seconds
  // by default. Let the relay close that worker before its own owner exits.
  const configuredGrace = Number(process.env.SHUTDOWN_GRACE_MS)
  const buddyGrace = Number.isFinite(configuredGrace) && configuredGrace > 0 ? configuredGrace : 15_000
  try {
    const child = spawnOwnedProcess(command, { cwd: root, env, stdout: 'ignore', stderr, stopGraceMs: buddyGrace + 2_000 })
    servers.push({ label, process: child, log })
  }
  finally {
    closeSync(stderr)
  }
}

let exitCode = 0
try {
  const migration = Bun.spawnSync(['./buddy', 'migrate', '--no-generate'], { cwd: root, env })
  if (migration.exitCode !== 0)
    throw new Error(`Could not migrate the browser fixture.
${migration.stdout.toString()}
${migration.stderr.toString()}`)
  startServer('API', production ? ['./buddy', 'serve:api', '--port', String(API_PORT)] : ['./buddy', 'dev:api'])
  startServer('site', ['./buddy', production ? 'serve' : 'dev:frontend'])
  await waitUntil('The API', async () => (await fetch(`http://localhost:${API_PORT}/api/postline/health`)).status < 500)
  await waitUntil('The site', async () => (await fetch(`${site}/login`)).ok)
  mkdirSync(out, { recursive: true })

  const { cdp, close } = await launch({ viewport: { width: 1280, height: 800 } })
  try {
    if (production) await watchPageSecurity(cdp)
    await checkFirstRun(cdp)
    if (!marketingScreenshots) await checkRejectedPublishInputs(cdp)
    if (marketingScreenshots) await captureMarketingScreenshots(cdp)
    else if (spanishWorkspace) await checkSpanishWorkspace(cdp)
    else await checkWorkspace(cdp)
  }
  finally {
    await close()
    await closeSharedBrowsers()
  }
}
catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
}
finally {
  const stopped = await Promise.allSettled(servers.map(server => server.process.stop()))
  for (const [index, result] of stopped.entries()) {
    if (result.status === 'rejected') failures.push(`Could not stop ${servers[index]!.label}: ${String(result.reason)}`)
  }
  if (failures.length) {
    for (const server of servers) {
      const said = readFileSync(server.log, 'utf8').trim().split('\n').slice(-15).join('\n')
      if (said) failures.push(`${server.label} said:\n${said}`)
    }
  }
  rmSync(work, { recursive: true, force: true })
}

if (failures.length) {
  exitCode = 1
  console.error(`${failures.length} problem(s):\n${failures.map(line => `  ${line}`).join('\n')}`)
}
else {
  // eslint-disable-next-line no-console
  console.log(marketingScreenshots
    ? `Product screenshots written to ${productImages}.`
    : spanishWorkspace ? 'Spanish workspace navigation, Queue, Activity, Timeline, Blog, Inbox, Listening, Analytics, Channels, Campaigns, Settings, and Composer passed.'
    : `Every view opened clean in ${MODES.map(mode => mode.name).join(', ')}. Screenshots in ${out}.`)
}
process.exit(exitCode)
