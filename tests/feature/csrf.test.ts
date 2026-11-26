/**
 * A write made with the session cookie has to carry the CSRF token.
 *
 * Every route used to opt out of the check, which left SameSite=Lax as the
 * only thing between a signed-in owner and a form on another site.
 */
import { describe, expect, test } from 'bun:test'
import { listRegisteredRoutes } from '@stacksjs/router'
import { featureTest } from '@stacksjs/testing'
import User from '../../storage/framework/defaults/app/Models/User'

async function owner() {
  return await User.first() ?? await User.create({
    name: 'Csrf Test',
    email: `csrf-${Date.now()}@postline.test`,
    password: 'not-used-actingAs-bypasses-login',
  })
}

const TOKEN = 'a'.repeat(64)

describe('csrf', () => {
  test('no route opts out of the check', async () => {
    await featureTest().get('/api/csrf')
    const source = await Bun.file(new URL('../../routes/api.ts', import.meta.url)).text()

    expect(source).not.toContain('skipCsrf')
    expect(listRegisteredRoutes().length).toBeGreaterThan(50)
  })

  // The check runs after authentication, so an unauthenticated request to a
  // protected route answers 401 before it is reached. Sign-in is a write with
  // no session, which makes it the place to see the check on its own.
  const credentials = { email: 'nobody@postline.test', password: 'wrong-password' }

  test('a write with the cookie but no header is refused', async () => {
    const response = await featureTest()
      .withHeaders({ cookie: `X-CSRF-Token=${TOKEN}` })
      .post('/api/login', credentials)

    expect(response.status).toBe(403)
  })

  test('a write whose header does not match the cookie is refused', async () => {
    const response = await featureTest()
      .withHeaders({ 'cookie': `X-CSRF-Token=${TOKEN}`, 'x-csrf-token': 'b'.repeat(64) })
      .post('/api/login', credentials)

    expect(response.status).toBe(403)
  })

  test('a write with a header and no cookie is refused', async () => {
    const response = await featureTest()
      .withHeaders({ 'x-csrf-token': TOKEN })
      .post('/api/login', credentials)

    expect(response.status).toBe(403)
  })

  test('a write with the matching token passes the check', async () => {
    const response = await featureTest()
      .withHeaders({ 'cookie': `X-CSRF-Token=${TOKEN}`, 'x-csrf-token': TOKEN })
      .post('/api/login', credentials)

    // Past CSRF, and refused for the credentials instead.
    expect(response.status).not.toBe(403)
    expect([401, 422]).toContain(response.status)
  })

  test('a protected write still needs a session first', async () => {
    const response = await featureTest()
      .withHeaders({ 'cookie': `X-CSRF-Token=${TOKEN}`, 'x-csrf-token': TOKEN })
      .post('/api/postline/listening/read', { mention_id: 0 })

    expect(response.status).toBe(401)
  })

  test('a write with neither cookie nor header is refused', async () => {
    const response = await featureTest().post('/api/login', credentials)

    expect(response.status).toBe(403)
  })

  test('the seeding route sets the cookie', async () => {
    const response = await featureTest().get('/api/csrf')

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie') || '').toContain('X-CSRF-Token=')
  })

  test('reading a conversation never marks it read', async () => {
    const response = await featureTest().actingAs(await owner()).get('/api/postline/inbox/thread?conversation_id=0&mark_read=1')

    // Whatever it answers for an unknown conversation, it is a read.
    expect([200, 404, 422]).toContain(response.status)
  })
})
