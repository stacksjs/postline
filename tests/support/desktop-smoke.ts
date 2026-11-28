import type { RunWebviewAppOptions } from '@stacksjs/desktop-build'
import { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { desktopAppPaths, runWebviewApp as launch } from '@stacksjs/desktop-build'
import { WORKSPACE_KEY_ID_FILE, WORKSPACE_KEY_SERVICE } from '../../app/Desktop/keychain'

export async function runWebviewApp(options: RunWebviewAppOptions): Promise<number> {
  const testHome = process.cwd()
  const paths = desktopAppPaths('Postline Desktop Check', { home: testHome, env: {} })

  try {
    return await launch({
      ...options,
      paths,
      logWhenDetached: false,
      spawn(command) {
        // Treat the launch URL exactly as the native window does, including
        // the one-time session exchange. No graphical window is opened in CI.
        const launchUrl = command.find(arg => arg.startsWith('http://127.0.0.1:'))
        const exited = launchUrl
          ? checkWorkspace(launchUrl, paths.dataDir).catch((error) => {
              console.error(error instanceof Error ? error.message : String(error))
              return 1
            })
          : Promise.resolve(1)
        return { exited, kill() {} }
      },
    })
  }
  finally {
    const keyId = join(paths.dataDir, WORKSPACE_KEY_ID_FILE)
    if (existsSync(keyId))
      await Bun.secrets.delete({ service: WORKSPACE_KEY_SERVICE, name: readFileSync(keyId, 'utf8').trim() })
    process.chdir(testHome)
  }
}

async function checkWorkspace(launchUrl: string, dataDir: string): Promise<number> {
  const { origin } = new URL(launchUrl)
  const failures: string[] = []
  let csrfToken = ''

  function check(what: string, passed: boolean, detail = ''): void {
    console.log(`${passed ? 'ok  ' : 'FAIL'} ${what}${!passed && detail ? `: ${detail}` : ''}`)
    if (!passed) failures.push(what)
  }

  const unauthenticated = await fetch(`${origin}/api/postline/bootstrap`, { redirect: 'manual' })
  check('the agent refuses a connection without a window session', unauthenticated.status === 401, String(unauthenticated.status))
  const entry = await fetch(launchUrl, { redirect: 'manual' })
  const sessionCookie = entry.headers.getSetCookie()[0]?.split(';')[0]
  if (!sessionCookie || ![302, 303].includes(entry.status))
    throw new Error(`The agent did not issue a window session (HTTP ${entry.status}).`)

  async function call(method: string, path: string, payload?: Record<string, string> | FormData | string, cookie?: string): Promise<{ status: number, type: string, text: string, headers: Headers }> {
    const isJson = typeof payload === 'string'
    const body = isJson || payload instanceof FormData
      ? payload
      : payload && Object.entries(payload).reduce((data, [key, value]) => (data.set(key, value), data), new FormData())
    const headers: Record<string, string> = { origin, cookie: [sessionCookie, cookie].filter(Boolean).join('; ') }
    if (isJson) headers['content-type'] = 'application/json'
    if (csrfToken && method !== 'GET') {
      headers.cookie += `; X-CSRF-Token=${csrfToken}`
      headers['x-csrf-token'] = csrfToken
    }
    const response = await fetch(`${origin}${path}`, { method, body, headers, redirect: 'manual' })
    const issued = response.headers.get('set-cookie')?.match(/X-CSRF-Token=([0-9a-f]+)/)?.[1]
    if (issued) csrfToken = issued

    return {
      status: response.status,
      type: response.headers.get('content-type')?.split(';')[0] ?? '',
      text: await response.text(),
      headers: response.headers,
    }
  }

  check('the working directory is the data directory', realpathSync(process.cwd()) === realpathSync(dataDir))
  check('the launcher points SQLite at the workspace', process.env.DB_CONNECTION === 'sqlite' && process.env.DB_DATABASE_PATH === join(dataDir, 'postline.sqlite'))
  const keychainItem = { service: WORKSPACE_KEY_SERVICE, name: readFileSync(join(dataDir, WORKSPACE_KEY_ID_FILE), 'utf8').trim() }
  const storedKey = await Bun.secrets.get(keychainItem)
  check('the workspace key is in Keychain', Boolean(storedKey) && storedKey === process.env.APP_KEY)
  check('there is no plaintext key file', !existsSync(join(dataDir, 'app.key')))

  // Postline's own config/, not the framework's defaults (#196). The framework
  // loads config/ by a dynamic import relative to the working directory, which
  // is the data directory here, so a silent fall-back would look like this:
  // passkeys off, a framework sender, the framework's mailbox server on.
  {
    const { config } = await import('@stacksjs/config')
    check('the app runs on Postline\'s config: passkeys', config.auth?.passkeys?.enabled === true && config.auth.passkeys.name === 'Postline', JSON.stringify(config.auth?.passkeys))
    check('the app runs on Postline\'s config: mail', String(config.email?.from?.address || '').startsWith('no-reply@') && (config.email as { server?: { enabled?: boolean } }).server?.enabled === false, JSON.stringify(config.email?.from))
  }

  const page = await call('GET', '/composer')
  check('Composer comes from the built views', page.status === 200 && page.text.includes('data-testid="composer-page"'), `${page.status} ${page.type}`)
  const settings = await call('GET', '/settings')
  check('Settings comes from the built views', settings.status === 200 && settings.text.includes('data-testid="settings-page"'), `${settings.status} ${settings.type}`)
  const hasCsrfBootstrap = (source: string): boolean => source.includes('/api/csrf') && source.includes('X-CSRF-Token')
  async function bootstrapsCsrf(html: string): Promise<boolean> {
    if (hasCsrfBootstrap(html)) return true
    for (const [, path] of html.matchAll(/<script\b[^>]*\bsrc="(\/_stx\/[^" ]+)"/g)) {
      const script = await call('GET', path!)
      if (script.status === 200 && hasCsrfBootstrap(script.text)) return true
    }
    return false
  }
  check('Composer bootstraps CSRF protection', await bootstrapsCsrf(page.text))
  check('Settings bootstraps CSRF protection', await bootstrapsCsrf(settings.text))
  const analytics = await call('GET', '/analytics')
  check('the desktop Analytics view survives its marketing namesake', analytics.status === 200 && analytics.text.includes('data-testid="analytics-page"'))
  const marketing = await call('GET', '/features/analytics')
  check('the desktop does not serve the marketing Analytics page', marketing.status !== 200)

  const front = await call('GET', '/')
  check('the landing page sends the window to the workspace', front.status === 302)

  const script = await call('GET', '/assets/scripts/view-code.ts')
  check('a workspace script is served as JavaScript', script.status === 200 && script.type === 'text/javascript' && !/\binterface\s+\w+\s*\{/.test(script.text), `${script.status} ${script.type}`)
  const alertsScript = await call('GET', '/assets/scripts/desktop-alerts.ts')
  check('the compiled workspace can load native alerts on demand', alertsScript.status === 200
    && alertsScript.type === 'text/javascript' && alertsScript.text.includes('bindDesktopAlerts'))

  for (const path of ['/api/csrf', '/api/postline/bootstrap', '/api/postline/providers', '/api/postline/queue', '/api/postline/recurring-posts', '/api/postline/draft-feeds', '/api/postline/accounts', '/api/postline/analytics', '/api/postline/campaigns', '/api/postline/listening', '/api/postline/inbox/mentions', '/api/postline/settings/retention']) {
    const read = await call('GET', path)
    check(`GET ${path}`, read.status === 200, `${read.status} ${read.text.slice(0, 160)}`)
  }

  const shortLinks = await call('GET', '/api/postline/analytics/links')
  check('the Mac agent reports short links unavailable without a public server', shortLinks.status === 200 && JSON.parse(shortLinks.text).data.enabled === false)
  const shortRedirect = await call('GET', '/api/r/1234567890abcdef')
  check('the Mac agent never serves a public redirect', shortRedirect.status === 404 && !shortRedirect.headers.has('location'))

  const unsigned = csrfToken
  csrfToken = ''
  const refused = await call('POST', '/api/postline/queue', { text: 'Sent without a CSRF token.', providers: 'blog' })
  check('a write without the CSRF token is refused', refused.status === 403, `${refused.status} ${refused.text.slice(0, 160)}`)
  csrfToken = unsigned
  check('the agent issued a CSRF token', csrfToken.length === 64, String(csrfToken.length))

  const presetsPath = '/api/postline/composer/presets'
  const saved = await call('POST', presetsPath, { kind: 'hashtags', name: 'Product update', body: '#Postline, OpenSource' })
  const preset = saved.status === 200 ? JSON.parse(saved.text).data : null
  check('the agent stores saved Composer text', preset?.body === '#Postline #OpenSource', `${saved.status} ${saved.text.slice(0, 160)}`)
  const presets = await call('GET', presetsPath)
  check('the agent lists saved Composer text', presets.status === 200 && JSON.parse(presets.text).data.some((row: { uuid: string }) => row.uuid === preset?.uuid))
  if (preset) {
    const removed = await call('POST', `${presetsPath}/delete`, { uuid: preset.uuid })
    check('the agent deletes saved Composer text', removed.status === 200)
  }

  const app = await call('POST', '/api/postline/network-apps', {
    provider: 'twitter',
    client_id: 'postline-desktop-test',
    client_secret: 'test-only',
  })
  check('saving a network app from the desktop workspace', app.status === 200)
  const consent = await call('GET', '/api/postline/twitter/auth')
  const location = new URL(consent.headers.get('Location') ?? '/', origin)
  const state = location.searchParams.get('state')
  const flowCookie = consent.headers.get('Set-Cookie')?.split(';')[0]
  check('desktop opens X consent with a loopback callback and browser-bound state', consent.status === 302
    && location.searchParams.get('redirect_uri') === `${origin}/api/postline/twitter/callback`
    && /^[a-f0-9]{64}$/.test(state ?? '') && Boolean(flowCookie))
  if (state && flowCookie) {
    const cancel = await call('GET', `/api/postline/twitter/callback?error=access_denied&state=${state}`, undefined, flowCookie)
    check('desktop clears the flow when consent is cancelled', cancel.status === 302
      && cancel.headers.get('Location')?.startsWith('/accounts?twitter=error') === true
      && cancel.headers.get('Set-Cookie')?.includes('Max-Age=0') === true)
  }

  const instagramPages = await call('GET', '/api/postline/instagram/pages')
  check('the compiled agent requires a bound Instagram Page selection', instagramPages.status === 422
    && JSON.parse(instagramPages.text)?.error?.includes('Connect Instagram again from Channels') === true,
  `${instagramPages.status} ${instagramPages.type}`)

  const browserSessionPath = '/api/postline/twitter/browser-session'
  const composerCheckPath = `${browserSessionPath}/composer-check`
  const beginComposerCheck = JSON.stringify({ begin: true })
  const session = await call('GET', browserSessionPath)
  const initialProfile = JSON.parse(session.text).data
  check('the native X browser session uses a workspace profile', session.status === 200
    && initialProfile?.handle === null && /^postline-x-[0-9a-f-]{36}$/.test(initialProfile?.profile ?? ''))
  const signedOut = JSON.stringify({ signed_out: true })
  const unconnected = await call('POST', browserSessionPath, signedOut)
  check('a signed-out page leaves a fresh X profile unconnected without a hold', unconnected.status === 200
    && JSON.parse(unconnected.text)?.data?.handle === null && JSON.parse(unconnected.text)?.data?.needsCheck === false)
  const unconnectedCheck = await call('POST', composerCheckPath, beginComposerCheck)
  check('a fresh workspace has no X Composer check to run', unconnectedCheck.status === 200 && JSON.parse(unconnectedCheck.text)?.data === null)
  const connectedBrowser = await call('POST', browserSessionPath, { handle: 'postline_test' })
  const savedBrowser = await call('GET', browserSessionPath)
  const savedProfile = JSON.parse(savedBrowser.text).data
  check('the native session remembers its X handle, profile and confirmation state', connectedBrowser.status === 200
    && savedBrowser.status === 200 && savedProfile?.handle === 'postline_test' && savedProfile?.profile === initialProfile?.profile
    && savedProfile.needsCheck === false && savedProfile.needsLayoutCheck === false
    && savedProfile.composerHealth === null && savedProfile.listeningNeedsAttention === false
    && Object.keys(savedProfile).sort().join(',') === 'composerHealth,handle,listeningNeedsAttention,needsCheck,needsLayoutCheck,profile')
  const attemptedChecks = await Promise.all([
    call('POST', composerCheckPath, beginComposerCheck),
    call('POST', composerCheckPath, beginComposerCheck),
  ])
  const checks = attemptedChecks.map(result => JSON.parse(result.text)?.data).filter(Boolean)
  const composerClaim = checks[0]
  check('exactly one window claims the daily X Composer check', attemptedChecks.every(result => result.status === 200)
    && checks.length === 1 && composerClaim.handle === savedProfile?.handle && composerClaim.profile === savedProfile?.profile)
  const reportLayout = JSON.stringify({ token: composerClaim?.token, health: 'layout' })
  const composerResult = await call('POST', composerCheckPath, reportLayout)
  const composerReplay = await call('POST', composerCheckPath, reportLayout)
  const sameDayCheck = await call('POST', composerCheckPath, beginComposerCheck)
  const afterComposer = await call('GET', browserSessionPath)
  check('the X Composer layout warning persists and its claim can be reported once', composerResult.status === 200
    && JSON.parse(composerResult.text)?.data?.recorded === true
    && JSON.parse(composerReplay.text)?.data?.recorded === false && JSON.parse(afterComposer.text)?.data?.composerHealth === 'layout'
    && sameDayCheck.status === 200 && JSON.parse(sameDayCheck.text)?.data === null)
  const foreignMetrics = await call('POST', `${browserSessionPath}/metrics`, { handle: 'another_user' })
  check('the native session rejects engagement from a different handle', foreignMetrics.status === 422
    && JSON.parse(foreignMetrics.text)?.error?.includes('Check the X browser sign-in') === true)
  const foreignMentions = await call('POST', `${browserSessionPath}/listening`, { handle: 'another_user' })
  check('the native session rejects Listening posts from a different handle', foreignMentions.status === 422
    && JSON.parse(foreignMentions.text)?.error?.includes('Check the X browser sign-in') === true)
  const watch = await call('POST', '/api/postline/listening', JSON.stringify({
    name: 'X browser fixture', keywords: ['Postline launch'], providers: ['twitter'], twitter_read_source: 'browser',
  }))
  const watchResult = JSON.parse(watch.text)?.data?.monitor
  check('the native agent saves an X browser watch', watch.status === 200 && watchResult?.twitterReadSource === 'browser')
  const visibleMentions = JSON.stringify({
    handle: 'postline_test',
    posts: [{ id: '8724', authorHandle: 'fixture_author', body: 'Postline launch fixture', postedAt: '2026-11-27T05:00:00.000Z' }],
  })
  const importedMentions = await call('POST', `${browserSessionPath}/listening`, visibleMentions)
  check('the native agent imports visible X posts without calling the X API', importedMentions.status === 200
    && JSON.parse(importedMentions.text)?.data?.created === 1)
  const savedMentions = await call('GET', `/api/postline/listening?monitor_id=${watchResult?.id}`)
  check('the imported X post appears in Listening', savedMentions.status === 200
    && JSON.parse(savedMentions.text)?.data?.mentions?.[0]?.url === 'https://x.com/fixture_author/status/8724')

  if (process.platform === 'darwin' && Number(release().split('.')[0]) >= 23) {
    const listeningPath = `${browserSessionPath}/listening-check`
    const scan = (operation: 'claim' | 'finish', details = {}) =>
      call('POST', listeningPath, JSON.stringify({ operation, ...details }))
    const manualOnly = await scan('claim')
    check('manual X browser watches do not start a background search', manualOnly.status === 200 && JSON.parse(manualOnly.text)?.data === null)
    const scheduledWatch = await call('POST', '/api/postline/listening', JSON.stringify({
      name: 'Paced browser search', keywords: ['Paced fixture'], providers: ['twitter'],
      twitter_read_source: 'browser', twitter_browser_background: true,
    }))
    const scheduledMonitor = JSON.parse(scheduledWatch.text)?.data?.monitor
    const searches = await Promise.all([scan('claim'), scan('claim')])
    const claims = searches.map(search => JSON.parse(search.text)?.data).filter(Boolean)
    const claimed = claims[0]
    check('the agent claims one enabled browser watch per interval', scheduledMonitor?.twitterBrowserBackground === true && claims.length === 1
      && claimed?.profile === savedProfile?.profile && claimed?.handle === 'postline_test' && claimed?.query === '"Paced fixture"')
    const captured = { token: claimed?.token, handle: claimed?.handle, state: 'captured',
      posts: [{ id: '8725', authorHandle: 'fixture_author', body: 'Paced fixture from background search', postedAt: '2026-11-27T05:00:00.000Z' }],
    }
    const report = await scan('finish', captured)
    const replay = await scan('finish', captured)
    const next = await scan('claim')
    const scheduledMentions = await call('GET', `/api/postline/listening?monitor_id=${scheduledMonitor?.id}`)
    check('the agent saves a scheduled browser result once and preserves the interval', report.status === 200
      && JSON.parse(report.text)?.data?.created === 1 && JSON.parse(replay.text)?.data?.recorded === false
      && JSON.parse(next.text)?.data === null && JSON.parse(scheduledMentions.text)?.data?.mentions?.[0]?.remoteUri === '8725')
  }

  await call('POST', browserSessionPath, signedOut)
  const paused = await call('GET', browserSessionPath)
  const pausedSession = JSON.parse(paused.text)?.data
  check('the native agent persists an X sign-in hold and preserves the last confirmed handle', paused.status === 200
    && pausedSession?.handle === savedProfile?.handle && pausedSession?.needsCheck === true)
  const blockedImport = await call('POST', `${browserSessionPath}/listening`, visibleMentions)
  check('the native agent rejects an X browser import while sign-in needs checking', blockedImport.status === 422
    && JSON.parse(blockedImport.text)?.error?.includes('Check the X browser sign-in') === true)
  const confirmedAgain = await call('POST', browserSessionPath, { handle: 'postline_test' })
  const confirmedState = JSON.parse(confirmedAgain.text)?.data
  check('confirming the X sign-in removes the hold and permits a fresh Composer check', confirmedAgain.status === 200
    && confirmedState?.needsCheck === false && confirmedState?.composerHealth === null)
  const resumedImport = await call('POST', `${browserSessionPath}/listening`, visibleMentions)
  check('the native agent accepts X browser imports after a new sign-in check', resumedImport.status === 200)

  const brokenLayout = JSON.stringify({ needs_check: true, needs_layout_check: true })
  const layoutHold = await call('POST', browserSessionPath, brokenLayout)
  check('the native agent persists an X layout hold', layoutHold.status === 200
    && JSON.parse(layoutHold.text)?.data?.needsLayoutCheck === true)
  const noHandle = await call('POST', browserSessionPath, JSON.stringify({ handle: null }))
  check('an empty handle cannot clear a native X session hold', noHandle.status === 422)
  const signedOutDuringHold = await call('POST', browserSessionPath, signedOut)
  const heldProfile = JSON.parse(signedOutDuringHold.text)?.data
  check('checking a signed-out X page preserves the last account and the layout hold', signedOutDuringHold.status === 200
    && heldProfile?.handle === 'postline_test' && heldProfile?.needsCheck === true && heldProfile?.needsLayoutCheck === true)
  const signInOnly = await call('POST', browserSessionPath, { handle: 'postline_test' })
  const layoutBlocked = await call('POST', `${browserSessionPath}/listening`, visibleMentions)
  check('a sign-in check alone cannot clear the layout hold or allow an import', signInOnly.status === 422
    && layoutBlocked.status === 422 && JSON.parse(layoutBlocked.text)?.error?.includes('Open a readable X Search or Mentions page') === true)
  const checkedLayout = await call('POST', browserSessionPath, JSON.stringify({ handle: 'postline_test', checked_layout: true }))
  check('the verified layout clears both X hold flags', checkedLayout.status === 200
    && JSON.parse(checkedLayout.text)?.data?.needsCheck === false && JSON.parse(checkedLayout.text)?.data?.needsLayoutCheck === false)

  const missingReply = await call('POST', '/api/postline/inbox/mentions/reply', { id: '99999', text: 'A fixture reply' })
  check('the compiled agent rejects a public reply without a saved mention', missingReply.status === 422
    && JSON.parse(missingReply.text)?.error === 'That reply or mention is no longer in Inbox.')

  const published = await call('POST', '/api/postline/publish', { text: 'Published by the desktop check.', title: 'Desktop check', providers: 'blog' })
  check('publishing to the blog', published.status === 200 && JSON.parse(published.text)?.data?.results?.[0]?.ok === true, `${published.status} ${published.text.slice(0, 200)}`)

  const draft = await call('POST', '/api/postline/queue', { text: 'A draft kept by the desktop check.', providers: 'blog' })
  check('saving a draft', draft.status === 200 && JSON.parse(draft.text)?.data?.status === 'draft', `${draft.status} ${draft.text.slice(0, 200)}`)

  const draftId = JSON.parse(draft.text).data?.postId
  const removed = await call('POST', '/api/postline/queue/delete', { id: String(draftId) })
  const token = JSON.parse(removed.text).data?.token
  check('removing a draft with Undo', removed.status === 200 && typeof token === 'string')

  const pending = await call('GET', '/api/postline/queue?include_undo=1')
  const pendingQueue = JSON.parse(pending.text).data
  check('the removed draft is hidden and can still be restored', pending.status === 200
    && !pendingQueue?.items?.some((post: { id: number }) => post.id === draftId)
    && pendingQueue?.removals?.some((receipt: { token: string }) => receipt.token === token))
  const restored = await call('POST', '/api/postline/queue/undo-delete', { token: token || '' })
  check('restoring the draft', restored.status === 200 && JSON.parse(restored.text).data?.count === 1)

  const database = new Database(join(dataDir, 'postline.sqlite'), { readonly: true })
  const posts = database.query('SELECT status FROM posts ORDER BY id').all() as Array<{ status: string }>
  const blog = database.query('SELECT slug FROM blog_posts').all() as Array<{ slug: string }>
  const ledger = (database.query('SELECT count(*) AS count FROM migrations').get() as { count: number }).count
  const webhookScheduler = database.query("SELECT last_status FROM job_heartbeats WHERE job = 'DeliverPostWebhooks'").get() as { last_status: string } | null
  const webhookOutbox = database.query('SELECT count(*) AS count FROM post_webhook_deliveries').get() as { count: number }
  database.close()

  check('both posts are in the database', posts.map(post => post.status).join(',') === 'published,draft', JSON.stringify(posts))
  check('the blog post is recorded', blog.length === 1 && blog[0]!.slug === 'desktop-check', JSON.stringify(blog))
  check('the database carries its migration ledger', ledger > 0, String(ledger))
  check('the Mac agent runs the webhook job without queuing events when disabled', webhookScheduler?.last_status === 'ok' && webhookOutbox.count === 0)
  check('the blog file is in the data directory', existsSync(join(dataDir, 'content/blog')) && readdirSync(join(dataDir, 'content/blog')).includes('desktop-check.md'))

  if (process.platform === 'darwin' && Number(release().split('.')[0]) >= 23) {
    const available = await call('GET', '/api/postline/bootstrap')
    const accounts: Array<{ id: number, handle: string, isDefault: boolean, transport?: string }> = JSON.parse(available.text).data?.accounts ?? []
    const selected = accounts.find(account => account.transport === 'browser' && account.handle === 'postline_test')
    check('the selected browser account is explicitly available alongside the API', Boolean(selected?.id) && selected?.isDefault === false)
    const path = `${browserSessionPath}/publish`
    const submit = (operation: string, token?: string, result?: { state: string, id?: string, ids?: string[] }) =>
      call('POST', path, JSON.stringify({ operation, token, result }))
    const startup = await call('POST', '/api/postline/queue', {
      text: 'A fixture waiting for the browser to start.',
      providers: `twitter:${selected?.id}`,
      scheduled_at: new Date(Date.now() + 600_000).toISOString().slice(0, 19).replace('T', ' '),
    })
    const startupId = JSON.parse(startup.text)?.data?.postId
    const waiting = await call('POST', '/api/postline/queue/publish-now', { id: String(startupId) })
    const beforeReady = await submit('claim')
    check('the queue may retry when the browser never had permission to submit', startup.status === 200
      && JSON.parse(waiting.text)?.data?.results?.[0]?.retry?.kind === 'transient'
      && JSON.parse(beforeReady.text)?.data === null)
    const claim = JSON.parse((await call('POST', composerCheckPath, beginComposerCheck)).text)?.data
    const healthy = await call('POST', composerCheckPath, JSON.stringify({ token: claim?.token, health: 'ready' }))
    check('the local agent accepts a healthy X Composer check', healthy.status === 200 && JSON.parse(healthy.text)?.data?.recorded === true)
    async function sendThroughBrowser(text: string, state: 'published' | 'uncertain' | 'layout', scheduled = false) {
      const input = { text, providers: `twitter:${selected?.id}` }
      const imageAlt = 'A single pixel for the compiled browser publish check.'
      const form = new FormData()
      for (const [key, value] of Object.entries(input)) form.set(key, value)
      if (state === 'published') {
        const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1gAAAAASUVORK5CYII=', 'base64')
        form.append('images', new File([bytes], 'pixel.png', { type: 'image/png' }))
        form.set('image_alts', JSON.stringify([imageAlt]))
      }
      const at = new Date(Date.now() + 600_000).toISOString().slice(0, 19).replace('T', ' ')
      const saved = scheduled
        ? await call('POST', '/api/postline/queue', { ...input, scheduled_at: at })
        : null
      const savedData = saved ? JSON.parse(saved.text)?.data : null
      if (scheduled) check('the browser account can be saved as a scheduled target', saved?.status === 200 && savedData?.status === 'scheduled', saved?.text)
      const pending = scheduled
        ? call('POST', '/api/postline/queue/publish-now', { id: String(savedData?.postId) })
        : call('POST', '/api/postline/publish', form)
      let work
      for (let attempt = 0; attempt < 25; attempt++) {
        const next = await submit('claim')
        work = JSON.parse(next.text)?.data
        if (work) break
        await Bun.sleep(40)
      }
      if (!work) throw new Error('The local X browser did not receive the queued post.')
      check('the browser receives the post and its exact account without credentials', work.text === text && work.handle === 'postline_test'
        && !Object.keys(work).some(key => /secret|credential|password/.test(key)))
      if (state === 'published') {
        check('the browser receives the image and its description on the normal publish route', work.images?.length === 1
          && work.images[0]?.altText === imageAlt && typeof work.images[0]?.base64 === 'string' && work.images[0]?.base64.length > 0)
      }
      if (state !== 'layout') {
        const authorized = await submit('authorize', work.token)
        const replay = await submit('authorize', work.token)
        check('the browser receives one permission to click Post', authorized.status === 200 && JSON.parse(authorized.text)?.data === true
          && replay.status === 200 && JSON.parse(replay.text)?.data === false)
      }
      const report = await submit('result', work.token, state === 'published' ? { state, id: '246810' } : { state })
      check('the local agent settles the X browser result', report.status === 200 && JSON.parse(report.text)?.data === true)
      return JSON.parse((await pending).text).data
    }
    const delivered = await sendThroughBrowser('A successful browser delivery fixture.', 'published')
    check('the normal Publish API uses the browser’s X receipt', delivered?.results?.[0]?.url === 'https://x.com/postline_test/status/246810')
    const uncertain = await sendThroughBrowser('An uncertain browser delivery fixture.', 'uncertain')
    const retry = await call('POST', '/api/postline/queue/publish-now', { id: String(uncertain?.postId) })
    const waitingAgain = await submit('claim')
    check('the durable X receipt prevents an uncertain target from clicking again', retry.status < 500
      && JSON.parse(retry.text)?.data?.results?.[0]?.error?.includes('X did not confirm')
      && JSON.parse(waitingAgain.text)?.data === null, retry.text)
    const reviewQueue = JSON.parse((await call('GET', '/api/postline/queue')).text)?.data?.items ?? []
    const uncertainRow = reviewQueue.find((row: { id: number }) => row.id === uncertain?.postId)
    const reviewId = uncertainRow?.providers?.[0]?.xBrowserReview
    check('the unresolved X receipt offers a profile review in Queue', Number.isSafeInteger(reviewId))
    const observed = { id: '246811', authorHandle: 'postline_test', body: 'An uncertain browser delivery fixture.', postedAt: new Date().toISOString() }
    const link = (post: typeof observed) => call('POST', '/api/postline/queue/link-x-browser-post', JSON.stringify({ target_id: reviewId, post }))
    const wrongAuthor = await link({ ...observed, authorHandle: 'another_user' })
    const wrongText = await link({ ...observed, body: 'A different post.' })
    const older = await link({ ...observed, postedAt: '2020-01-01T00:00:00.000Z' })
    const duplicate = await link({ ...observed, id: '246810' })
    check('linking rejects a different account, different content, an old post, or an already linked ID',
      [wrongAuthor, wrongText, older, duplicate].every(response => response.status === 422))
    const linked = await link(observed)
    const replayMatch = await link(observed)
    const afterLink = JSON.parse((await call('GET', '/api/postline/queue')).text)?.data?.items
    const linkedRow = afterLink?.find((row: { id: number }) => row.id === uncertain?.postId)
    check('an observed X post can settle its Queue receipt without another submission', linked.status === 200 && replayMatch.status === 422
      && linkedRow?.status === 'published' && linkedRow?.providers?.[0]?.remoteUrl === 'https://x.com/postline_test/status/246811'
      && !linkedRow?.providers?.[0]?.xBrowserReview && JSON.parse((await submit('claim')).text)?.data === null)
    async function browserThread(texts: string[], ids: string[], schedule: boolean, mixed = false) {
      const input = { text: texts[0]!, thread: JSON.stringify(texts), providers: `twitter:${selected?.id}${mixed ? ',blog' : ''}` }
      const saved = schedule ? await call('POST', '/api/postline/queue', {
        ...input, scheduled_at: new Date(Date.now() + 600_000).toISOString().slice(0, 19).replace('T', ' '),
      }) : null
      const scheduleId = saved && JSON.parse(saved.text)?.data?.postIds?.[0]
      if (schedule && (!scheduleId || saved?.status !== 200)) throw new Error(`Could not schedule the X browser thread: ${saved?.text}`)
      const pending = schedule
        ? call('POST', '/api/postline/queue/publish-now', { id: String(scheduleId) })
        : call('POST', '/api/postline/publish', input)
      let work
      for (let attempt = 0; attempt < 30; attempt++) {
        work = JSON.parse((await submit('claim')).text)?.data
        if (work) break
        await Bun.sleep(50)
      }
      if (!work) {
        const result = await pending
        throw new Error(`The X browser thread was not offered to the renderer: ${result.text}`)
      }
      const granted = await submit('authorize', work.token)
      const duplicate = await submit('authorize', work.token)
      check('the browser claims the ordered thread and receives one grant for Post all', work.text === texts[0]
        && JSON.stringify(work.replies) === JSON.stringify(texts.slice(1))
        && JSON.parse(granted.text)?.data === true && JSON.parse(duplicate.text)?.data === false)
      if (ids.length > 1) {
        const duplicateIds = await submit('result', work.token, { state: 'thread', ids: [ids[0]!, ids[0]!] })
        check('a thread report cannot reuse a post ID', duplicateIds.status === 422)
      }
      const report = await submit('result', work.token, { state: 'thread', ids })
      check('the browser thread report is accepted', JSON.parse(report.text)?.data === true)
      return { data: JSON.parse((await pending).text)?.data, token: work.token }
    }
    const queuedThread = await browserThread(['Scheduled X root', 'Scheduled X reply'], ['346810', '346811'], true)
    check('the scheduled X thread returns both ordered post URLs', queuedThread.data?.results?.map((result: { url: string }) => result.url).join(',')
      === 'https://x.com/postline_test/status/346810,https://x.com/postline_test/status/346811')
    const interrupted = await browserThread(['Interrupted X root', 'Interrupted X reply', 'Interrupted X ending'], ['346820'], false)
    check('the immediate X thread records the confirmed root and holds both uncertain replies',
      interrupted.data?.postIds?.length === 3 && interrupted.data?.results?.[0]?.uri === '346820'
      && interrupted.data?.results?.slice(1).every((result: { ok: boolean, error?: string }) => !result.ok && result.error?.includes('did not confirm')))
    const firstResume = await call('POST', '/api/postline/queue/publish-now', { id: String(interrupted.data?.postIds?.[1]) })
    check('a resumed X thread cannot resubmit its uncertain replies', JSON.parse(firstResume.text)?.data?.results?.length === 2
      && JSON.parse((await submit('claim')).text)?.data === null)
    const currentQueue = JSON.parse((await call('GET', '/api/postline/queue')).text)?.data?.items ?? []
    const interruptedReply = currentQueue.find((entry: { id: number }) => entry.id === interrupted.data?.postIds?.[1])
    const manual = await call('POST', '/api/postline/queue/link-x-browser-post', JSON.stringify({
      target_id: interruptedReply?.providers?.[0]?.xBrowserReview,
      post: { ...observed, id: '346821', body: 'Interrupted X reply', postedAt: new Date().toISOString() },
    }))
    check('an unresolved X reply can be confirmed from its own profile post', manual.status === 200
      && JSON.parse(manual.text)?.data?.url === 'https://x.com/postline_test/status/346821')
    const late = await submit('result', interrupted.token, { state: 'thread', ids: ['346820', '346821', '346822'] })
    const secondResume = await call('POST', '/api/postline/queue/publish-now', { id: String(interrupted.data?.postIds?.[2]) })
    check('a late thread response recovers the remaining reply without submitting again', JSON.parse(late.text)?.data === true
      && JSON.parse(secondResume.text)?.data?.results?.map((result: { uri: string }) => result.uri).join(',') === '346822'
      && JSON.parse((await submit('claim')).text)?.data === null)
    const mixed = await browserThread(['Browser and Blog root', 'Browser and Blog reply'], ['346830', '346831'], false, true)
    const mixedResults: Array<{ ok: boolean, provider: string }> = mixed.data?.results ?? []
    check('a thread can keep its independent Blog target alongside the browser batch', mixedResults.length === 4
      && mixedResults.every(result => result.ok) && mixedResults.filter(result => result.provider === 'blog').length === 2)
    const held = await sendThroughBrowser('A scheduled X layout fixture.', 'layout', true)
    const heldState = await call('GET', browserSessionPath)
    check('a changed Composer layout holds the selected X target in the queue', Boolean(held?.postId)
      && held.results?.[0]?.ok === false && held.results?.[0]?.error?.includes('could not verify the X Composer')
      && JSON.parse(heldState.text)?.data?.composerHealth === 'layout')
  }

  const pendingErasure = await call('POST', browserSessionPath, brokenLayout)
  check('the erasure fixture starts with an X layout hold', JSON.parse(pendingErasure.text).data?.needsLayoutCheck === true)
  const browserActivity = await call('GET', '/api/postline/alerts')
  const browserAlerts: Array<{ title: string }> = JSON.parse(browserActivity.text)?.data?.alerts ?? []
  check('sign-out and repeated layout warnings raise one owner alert per reason', browserActivity.status === 200
    && browserAlerts.filter(item => item.title === 'X browser sign-in needs attention').length === 1
    && browserAlerts.filter(item => item.title === 'X browser reads paused').length === 1)
  const system = await call('GET', '/api/postline/system')
  const localProfile: string | null = JSON.parse(system.text).data?.localTwitterProfile
  const canHaveNativeProfile = process.platform === 'darwin' && Number(release().split('.')[0]) >= 23
  if (canHaveNativeProfile) {
    check('the erasure scope identifies this Mac’s named profile', localProfile === initialProfile.profile)
    const blocked = await call('POST', '/api/postline/settings/delete-everything', { confirmation: 'DELETE EVERYTHING' })
    const stillSaved = await call('GET', browserSessionPath)
    const stillQueued = await call('GET', '/api/postline/queue')
    check('the agent keeps the workspace and handle until the native profile is erased', blocked.status === 409
      && JSON.parse(stillSaved.text).data?.handle === 'postline_test'
      && JSON.parse(stillQueued.text).data?.items?.some((item: { status: string }) => item.status === 'draft') === true)
  }
  else {
    check('the erasure scope stays within the workspace on this platform', localProfile === null)
  }
  const erased = await call('POST', '/api/postline/settings/delete-everything', {
    confirmation: 'DELETE EVERYTHING',
    ...(localProfile && { removedTwitterProfile: localProfile }),
  })
  const afterErasure = await call('GET', browserSessionPath)
  const remainingSession = JSON.parse(afterErasure.text).data
  check('workspace erasure clears X sign-in state and keeps the owner profile identity', erased.status === 200
    && typeof JSON.parse(erased.text).data?.deleted?.posts === 'number'
    && remainingSession?.profile === initialProfile.profile
    && remainingSession?.handle === null && remainingSession?.needsCheck === false && remainingSession?.needsLayoutCheck === false)

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`)
    return 1
  }

  console.log('\nThe desktop agent works as a compiled binary.')
  return 0
}
