/**
 * Passkeys (#95), through Postline's own routes: add one while signed in,
 * sign in with it, and remove it with the password. The password keeps
 * working throughout, so a passkey is never the only way in.
 */
import { describe, expect, test } from 'bun:test'
import { createToken, register } from '@stacksjs/auth'
import { config } from '@stacksjs/config'
import { featureTest } from '@stacksjs/testing'
import User from '../../storage/framework/defaults/app/Models/User'
import { softwarePasskey } from '../support/webauthn-device'

const PASSWORD = 'passkey-test-password'

async function owner() {
  const email = `passkeys-${Date.now()}@postline.test`
  // Registered the way the owner is, so the password is hashed as in the app.
  await register({ email, password: PASSWORD, name: 'Passkey Test' })
  return await User.where('email', email).first() as unknown as { id: number, email: string }
}

const origin = (): string => String(config.auth.passkeys?.origin)
// A signed-out browser: the CSRF cookie and its echo, as CsrfScripts sends them.
const CSRF = 'c'.repeat(64)
const signedOut = (headers: Record<string, string> = {}) => featureTest().withHeaders({ 'cookie': `X-CSRF-Token=${CSRF}`, 'x-csrf-token': CSRF, 'Origin': origin(), ...headers })

describe('passkeys', () => {
  test('are on, bound to a real origin', () => {
    expect(config.auth.passkeys?.enabled).toBe(true)
    expect(() => new URL(origin())).not.toThrow()
  })

  test('adding one needs a session', async () => {
    const response = await featureTest().post('/api/auth/passkeys/registration/options', {})
    expect(response.status).toBe(401)
  })

  test('signing in with one refuses another origin', async () => {
    const response = await signedOut({ Origin: 'https://elsewhere.example' }).post('/api/auth/passkeys/authentication/options', {})
    expect(response.status).toBe(403)
  })

  test('add one, sign in with it, then remove it with the password', async () => {
    const user = await owner()
    const { plainTextToken } = await createToken(Number(user.id), 'passkey-test')
    const signedIn = featureTest().withHeaders({ Authorization: `Bearer ${plainTextToken}`, Origin: origin() })
    const device = await softwarePasskey(origin())

    const begin = await signedIn.post('/api/auth/passkeys/registration/options', {})
    expect(begin.status).toBe(200)
    const registration = await begin.json<{ ceremony: string, options: { challenge: string } }>()
    const finish = await signedIn.post('/api/auth/passkeys/registration', { ceremony: registration.ceremony, credential: device.register(registration.options.challenge) })
    expect(finish.status).toBe(200)

    const listed = await (await signedIn.get('/api/auth/passkeys')).json<{ passkeys: { id: string }[] }>()
    expect(listed.passkeys).toHaveLength(1)

    const anonymous = signedOut()
    const challenge = await (await anonymous.post('/api/auth/passkeys/authentication/options', {})).json<{ ceremony: string, options: { challenge: string } }>()
    const login = await anonymous.post('/api/auth/passkeys/authentication', { ceremony: challenge.ceremony, credential: device.assert(challenge.options.challenge) })
    expect(login.status).toBe(200)
    expect((await login.json<{ user: { id: number } }>()).user.id).toBe(Number(user.id))
    expect(login.headers.get('set-cookie') ?? '').toContain('auth-token=')

    const id = encodeURIComponent(listed.passkeys[0]!.id)
    // A wrong password is not proof of another way in, so the last passkey stays.
    expect((await signedIn.delete(`/api/auth/passkeys/${id}`, { password: 'wrong' })).status).toBe(400)
    expect((await signedIn.delete(`/api/auth/passkeys/${id}`, { password: PASSWORD })).status).toBe(200)
    expect((await (await signedIn.get('/api/auth/passkeys')).json<{ passkeys: unknown[] }>()).passkeys).toHaveLength(0)
  })
})
