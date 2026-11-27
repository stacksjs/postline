/** Exercise the packaged extension's toolbar action in a disposable Chrome for Testing profile. */
import type { Cdp } from '@stacksjs/testing/browser'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnOwnedProcess } from '@stacksjs/cli/owned-process'
import { connect, findChrome, waitFor } from '@stacksjs/testing/browser'
import { sharedPage } from '../resources/functions/composer-share'

interface TargetInfo {
  targetId: string
  type: string
  url: string
}

const chromePath = findChrome()
if (!chromePath) throw new Error('Install Chrome for Testing before checking the browser extension.')
const extension = resolve(import.meta.dir, '../dist-extension/chrome')
if (!await Bun.file(join(extension, 'manifest.json')).exists())
  throw new Error('Run ./buddy extension:build --target chrome first.')

const profile = mkdtempSync(join(tmpdir(), 'postline-extension-chrome-'))
const requests: string[] = []
const site = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    requests.push(request.url)
    return new Response('Postline browser share fixture')
  },
})
const source = new URL('/article?q=red+blue#section', site.url).href
const chrome = spawnOwnedProcess([
  chromePath, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profile}`, source,
], { stdout: 'ignore', stderr: 'ignore' })
let browser: Cdp | undefined
let popup: Cdp | undefined
try {
  const port = await waitFor(async () => {
    const file = Bun.file(join(profile, 'DevToolsActivePort'))
    return (await file.exists()) && Number((await file.text()).split('\n')[0])
  }, 15000, { label: 'Chrome debugging port' })
  const version: { webSocketDebuggerUrl: string } = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json())
  const chromeClient = browser = await connect(version.webSocketDebuggerUrl)
  const targets = async () => (await chromeClient.send<{ targetInfos: TargetInfo[] }>('Target.getTargets', {
    filter: [{ type: 'tab' }, { type: 'other' }, { type: 'page' }],
  })).targetInfos
  const tab = await waitFor(async () => (await targets()).find(target => target.type === 'tab' && target.url === source))
  const { id } = await browser.send<{ id: string }>('Extensions.loadUnpacked', { path: extension })
  await browser.send('Extensions.triggerAction', { id, targetId: tab.targetId })

  const popupUrl = `chrome-extension://${id}/popup.html`
  const target = await waitFor(async () => (await targets()).find(target => target.url === popupUrl))
  const popupClient = popup = await connect(`ws://127.0.0.1:${port}/devtools/page/${target.targetId}`)
  await waitFor(() => popupClient.evaluate<boolean>(`
    document.querySelector('#shared-page')?.textContent === ${JSON.stringify(source)}
      && !document.querySelector('button[type=submit]').disabled
      && document.querySelector('img').naturalWidth === 32
      && Boolean(document.querySelector('link[rel=stylesheet]').sheet)`), 6000, { label: 'the rendered extension popup' })
  await popup.evaluate(`document.querySelector('[name=workspace]').value = ${JSON.stringify(site.url.origin)}`)
  await popup.evaluate("document.querySelector('form').requestSubmit()")
  const opened = await waitFor(async () => (await targets()).find(target => target.url.startsWith(site.url.origin + '/composer#')))
  if (sharedPage(new URL(opened.url).hash) !== source) throw new Error('The shared URL changed in transit.')
  await waitFor(() => requests.includes(site.url.origin + '/composer'))
  if (requests.some(url => url.includes('postline-share'))) throw new Error('The share payload reached the HTTP server.')
  console.log('Chrome shared the active tab into Composer without sending the link in the HTTP request.')
}
finally {
  popup?.disconnect()
  browser?.disconnect()
  await chrome.stop()
  site.stop(true)
  rmSync(profile, { recursive: true, force: true })
}
