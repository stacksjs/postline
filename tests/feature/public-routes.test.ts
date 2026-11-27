/**
 * The routes that answer without a session, written down.
 *
 * A route is public here when it carries no `auth` middleware. The list is
 * compared exactly, in both directions: a route that becomes public fails the
 * suite, and so does one that stops being served. That is the point. Routes
 * can arrive from a framework upgrade or a config switch as easily as from
 * `routes/api.ts`, and nothing else in the suite would notice.
 *
 * To make a route public on purpose, add it below with the reason.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { listRegisteredRoutes } from '@stacksjs/router'
import { featureTest } from '@stacksjs/testing'

/** Declared in `routes/api.ts`. */
const APP_PUBLIC = [
  // Signing in, claiming an unclaimed workspace, and ending a session.
  'POST /api/login',
  'POST /api/register',
  'POST /api/logout',
  // Signing in with a passkey, and the code step after the password (#95).
  // Each needs what only the owner has: the passkey, or a challenge the
  // password just issued plus the authenticator's code.
  'POST /api/auth/passkeys/authentication/options',
  'POST /api/auth/passkeys/authentication',
  'POST /api/auth/two-factor/verify',
  // Hands a browser its CSRF cookie. Reads and changes nothing.
  'GET /api/csrf',
  // Instagram and Threads fetch a queued image from here, server to server.
  'GET /api/postline/media',
  'GET /api/postline/blog/media',
  // A reader of a post can follow an opaque short link. Creation needs a session.
  'GET /api/r/{code}',
  'HEAD /api/r/{code}',
  // One boolean for the first-run and sign-in pages, with no account details.
  'GET /api/postline/setup/availability',
  // Health for a load balancer: database and scheduler state, nothing else.
  'GET /api/postline/health',
  // The waitlist, 'POST /api/subscribe', is mounted only on the marketing
  // deployment (POSTLINE_SITE=marketing), never on an install; see
  // tests/unit/marketing-site.test.ts.
]

/** Registered by the framework itself, whatever the app's route files say. */
const FRAMEWORK_PUBLIC = [
  // Unsubscribe from a list, by the token in an email's link. Always mounted:
  // anyone ever emailed must be able to leave. The signup and its confirm
  // link (POST /api/email/subscribe, GET /api/email/confirm) are mounted only
  // on the marketing site (config/email.ts, newsletter.signup).
  'GET /api/email/unsubscribe',
  'POST /api/email/unsubscribe',
  'GET /_stacks/email/unsubscribe/{token}',
  'POST /_stacks/email/unsubscribe/{token}',
  'GET /_stacks/mail/preview',
  'GET /_stacks/mail/preview/{name}',
  'GET /_stacks/mail/preview/{name}/raw',
  // Installed apps check for signed releases before anyone signs in.
  'GET /api/updates/{platform}/{arch}',
  'GET /api/updates/files/{channel}/{target}/{version}/{file}',
  'GET /locale/{locale}',
  'GET /robots.txt',
  'POST /webhooks/email/mailgun',
  'POST /webhooks/email/postmark',
  'POST /webhooks/email/sendgrid',
  'POST /webhooks/email/ses',
]

async function registeredRoutes() {
  // The first request is what loads the route files.
  await featureTest().get('/api/postline/queue')
  return listRegisteredRoutes()
}

const key = (route: { method: string, path: string }): string => `${route.method} ${route.path}`

describe('public routes', () => {
  test('are exactly the ones written down here', async () => {
    const routes = await registeredRoutes()
    const open = routes.filter(route => !route.middleware?.includes('auth')).map(key).sort()

    expect(open).toEqual([...APP_PUBLIC, ...FRAMEWORK_PUBLIC].sort())
  })

  test('every network connection route needs a session', async () => {
    const routes = await registeredRoutes()
    const connecting = routes.filter(route => /^\/api\/postline\/[a-z]+\/(auth|callback|connect)$/.test(route.path))

    // Four OAuth networks with auth + callback + connect, plus Bluesky and
    // Mastodon, which connect with a pasted credential.
    expect(connecting.length).toBe(14)
    for (const route of connecting)
      expect(route.middleware).toContain('auth')
  })

  test.each([
    ['/api/dashboard/environment'],
    ['/api/dashboard/data/users'],
    ['/register'],
    ['/versions'],
    ['/schedule'],
  ])('%s is not served', async (path) => {
    const routes = await registeredRoutes()

    expect(routes.some(route => route.path === path)).toBe(false)
  })

  test('routes/ holds one route file', () => {
    // The server loads some `routes/*.ts` files by name, outside the registry
    // this suite can list: `routes/buddy.ts` was served at the root with no
    // middleware at all. Anything added here needs the same scrutiny as a
    // line in the list above.
    const files = readdirSync(join(import.meta.dir, '../../routes')).filter(name => name.endsWith('.ts'))

    expect(files).toEqual(['api.ts'])
  })

  test('a claimed desktop header does not sign anyone in', async () => {
    const response = await featureTest()
      .withHeaders({ 'x-postline-native': 'craft', 'host': 'localhost', 'origin': 'http://localhost' })
      .get('/api/postline/queue')

    expect(response.status).toBe(401)
  })

  test('an OAuth callback without a session is refused', async () => {
    for (const network of ['linkedin', 'instagram', 'threads', 'twitter']) {
      const response = await featureTest().get(`/api/postline/${network}/callback?code=x&state=y`)

      expect(response.status).toBe(401)
    }
  })
})
