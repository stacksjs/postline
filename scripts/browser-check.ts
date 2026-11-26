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
const API_PORT = Number(process.env.BROWSER_CHECK_API_PORT) || 3208
const SITE_PORT = Number(process.env.BROWSER_CHECK_PORT) || 3200
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
      const body = new FormData()
      body.set('name', 'Browser Check')
      body.set('email', 'check@postline.test')
      body.set('password', 'browser-check-password')
      await fetch('/api/register', { method: 'POST', body })
      const login = await fetch('/api/login', { method: 'POST', body })
      const payload = await login.json()
      if (!payload.token && !payload.access_token) return 'login failed: ' + JSON.stringify(payload)
      document.cookie = 'postline-signed-in=1; path=/'
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
      }
    }
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
