import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { featureTest } from '@stacksjs/testing'

test('first-owner registration is atomic', async () => {
  const path = '/api/postline/setup/availability'
  const before = await featureTest().get(path)
  assert.equal(before.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await before.json(), { ok: true, data: { available: true } })

  const csrf = 'c'.repeat(64)
  const attempts = await Promise.all(['first', 'second'].map(name => featureTest()
    .withHeaders({ 'cookie': `X-CSRF-Token=${csrf}`, 'x-csrf-token': csrf })
    .post('/api/register', { name: `${name} owner`, email: `${name}@postline.test`, password: 'first-owner-test' })))

  assert.deepEqual(attempts.map(attempt => attempt.status).sort(), [200, 403])
  const owner = attempts.find(attempt => attempt.status === 200)!
  assert.match(owner.headers.get('set-cookie') ?? '', /auth-token=.*HttpOnly/i)
  assert.deepEqual(await (await featureTest().get(path)).json(), { ok: true, data: { available: false } })
  assert.equal((await featureTest().get('/api/postline/bootstrap')).status, 401)
})
