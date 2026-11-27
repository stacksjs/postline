/**
 * Prove the desktop agent works, as the compiled binary the app ships.
 *
 * Unit tests run the agent's code from source, inside the project, where the
 * framework can find everything it looks for on disk. The app is neither: it
 * is one compiled binary started somewhere with no project around it, and the
 * failures that matter only happen there. Routes that answered from source
 * answered 500 once compiled, because their middleware could not be loaded,
 * and the workspace's scripts were served as TypeScript the web view refused.
 *
 * So this is compiled and run from an empty directory:
 *
 *   bun scripts/desktop-bundle.ts
 *   bun build --compile scripts/desktop-check.ts --outfile /tmp/postline-check
 *   (cd /tmp && ./postline-check)
 *
 * It starts the agent on a fresh data directory, publishes a post and saves a
 * draft through the real API, and reads them back from the database. Exit
 * code 0 means every check passed. The release workflow runs it before it
 * images the app.
 */
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import agent from '../app/Desktop/Agent'
import { WORKSPACE_KEY_ID_FILE, WORKSPACE_KEY_SERVICE } from '../app/Desktop/keychain'

const dataDir = mkdtempSync(join(tmpdir(), 'postline-desktop-check-'))
const origin = 'http://127.0.0.1:4999'
const context = { appName: 'Postline', version: '0.0.0', origin, port: 4999, dataDir }
const failures: string[] = []
let csrfToken = ''

function check(what: string, passed: boolean, detail = ''): void {
  // eslint-disable-next-line no-console
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${what}${!passed && detail ? `: ${detail}` : ''}`)
  if (!passed) failures.push(what)
}

async function call(method: string, path: string, payload?: Record<string, string> | string, cookie?: string): Promise<{ status: number | null, type: string, text: string, headers: Headers }> {
  const isJson = typeof payload === 'string'
  const body = isJson
    ? payload
    : payload && Object.entries(payload).reduce((data, [key, value]) => (data.set(key, value), data), new FormData())
  // A write has to carry the CSRF token the way the window's own `fetch`
  // wrapper does: the cookie's value echoed in a header.
  const headers: Record<string, string> = { origin }
  if (isJson) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  if (csrfToken && method !== 'GET') {
    headers.cookie = [headers.cookie, `X-CSRF-Token=${csrfToken}`].filter(Boolean).join('; ')
    headers['x-csrf-token'] = csrfToken
  }
  const response = await agent.fetch!(new Request(`${origin}${path}`, { method, body, headers })) as Response | undefined
  const issued = response?.headers.get('set-cookie')?.match(/X-CSRF-Token=([0-9a-f]+)/)?.[1]
  if (issued)
    csrfToken = issued

  return {
    status: response ? response.status : null,
    type: response?.headers.get('content-type')?.split(';')[0] ?? '',
    text: response ? await response.text() : '',
    headers: response?.headers ?? new Headers(),
  }
}

await agent.start!({ ...context, launch: { args: [], cwd: dataDir } } as never)

check('the working directory is the data directory', realpathSync(process.cwd()) === realpathSync(dataDir))
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
check('a page is left to the built views', page.status === null)

const front = await call('GET', '/')
check('the landing page sends the window to the workspace', front.status === 302)

const script = await call('GET', '/assets/scripts/view-code.ts')
check('a workspace script is served as JavaScript', script.status === 200 && script.type === 'text/javascript' && !/\binterface\s+\w+\s*\{/.test(script.text), `${script.status} ${script.type}`)

for (const path of ['/api/csrf', '/api/postline/bootstrap', '/api/postline/providers', '/api/postline/queue', '/api/postline/accounts', '/api/postline/analytics', '/api/postline/campaigns', '/api/postline/listening', '/api/postline/settings/retention']) {
  const read = await call('GET', path)
  check(`GET ${path}`, read.status === 200, `${read.status} ${read.text.slice(0, 160)}`)
}

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

const browserSessionPath = '/api/postline/twitter/browser-session'
const session = await call('GET', browserSessionPath)
const initialProfile = JSON.parse(session.text).data
check('the native X browser session uses a workspace profile', session.status === 200
  && initialProfile?.handle === null && /^postline-x-[0-9a-f-]{36}$/.test(initialProfile?.profile ?? ''))
const invalidHandle = await call('POST', browserSessionPath, { handle: 'https://x.com/fixture' })
check('the native session rejects an invalid X handle', invalidHandle.status === 422)
const connectedBrowser = await call('POST', browserSessionPath, { handle: 'postline_test' })
const savedBrowser = await call('GET', browserSessionPath)
const savedProfile = JSON.parse(savedBrowser.text).data
check('the native session remembers only its X handle and profile', connectedBrowser.status === 200
  && savedBrowser.status === 200 && savedProfile?.handle === 'postline_test' && savedProfile?.profile === initialProfile?.profile
  && Object.keys(savedProfile).sort().join(',') === 'handle,profile')
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
const importedMentions = await call('POST', `${browserSessionPath}/listening`, JSON.stringify({
  handle: 'postline_test',
  posts: [{ id: '8724', authorHandle: 'fixture_author', body: 'Postline launch fixture', postedAt: '2026-11-27T05:00:00.000Z' }],
}))
check('the native agent imports visible X posts without calling the X API', importedMentions.status === 200
  && JSON.parse(importedMentions.text)?.data?.created === 1)
const savedMentions = await call('GET', `/api/postline/listening?monitor_id=${watchResult?.id}`)
check('the imported X post appears in Listening', savedMentions.status === 200
  && JSON.parse(savedMentions.text)?.data?.mentions?.[0]?.url === 'https://x.com/fixture_author/status/8724')

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
database.close()

check('both posts are in the database', posts.map(post => post.status).join(',') === 'published,draft', JSON.stringify(posts))
check('the blog post is recorded', blog.length === 1 && blog[0]!.slug === 'desktop-check', JSON.stringify(blog))
check('the database carries its migration ledger', ledger > 0, String(ledger))
check('the blog file is in the data directory', existsSync(join(dataDir, 'content/blog')) && readdirSync(join(dataDir, 'content/blog')).includes('desktop-check.md'))

await agent.stop?.()
await Bun.secrets.delete(keychainItem)
rmSync(dataDir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log('\nThe desktop agent works as a compiled binary.')
process.exit(0)
