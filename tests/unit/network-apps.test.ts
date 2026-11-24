import { describe, expect, test } from 'bun:test'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { defaultRedirectUrl, networkApps } from '../../app/Services/NetworkAppService'

const database = db as any

describe('the owner\'s own app on each network', () => {
  test('nothing set up means nothing to connect with, and a redirect worked out from the app address', async () => {
    await networkApps.clear('linkedin')
    const before = { id: process.env.LINKEDIN_CLIENT_ID, redirect: process.env.LINKEDIN_REDIRECT_URL }
    delete process.env.LINKEDIN_CLIENT_ID
    delete process.env.LINKEDIN_REDIRECT_URL
    const credentials = await networkApps.credentials('linkedin')
    expect(credentials.source).toBe('none')
    expect(credentials.clientId).toBe('')
    expect(credentials.redirectUrl).toMatch(/\/api\/postline\/linkedin\/callback$/)
    if (before.id !== undefined) process.env.LINKEDIN_CLIENT_ID = before.id
    if (before.redirect !== undefined) process.env.LINKEDIN_REDIRECT_URL = before.redirect
  })

  test('saved in Settings, the secret is stored sealed and read back whole', async () => {
    await networkApps.save('threads', { clientId: '1234567890', clientSecret: 'shh-very-secret' })

    const stored = await database.selectFrom('network_apps').selectAll().where('provider', '=', 'threads').executeTakeFirstOrThrow()
    expect(stored.client_secret).not.toContain('shh-very-secret')
    expect(String(stored.client_secret)).toStartWith('enc:v1:')

    const credentials = await networkApps.credentials('threads')
    expect(credentials).toMatchObject({ clientId: '1234567890', clientSecret: 'shh-very-secret', source: 'settings' })
    await networkApps.clear('threads')
  })

  test('the summary never carries the secret', async () => {
    await networkApps.save('instagram', { clientId: 'app-id', clientSecret: 'app-secret' })
    const summary = (await networkApps.summary()).find(entry => entry.provider === 'instagram')!
    expect(summary).toMatchObject({ configured: true, source: 'settings', clientId: 'app-id', hasSecret: true })
    expect(JSON.stringify(summary)).not.toContain('app-secret')
    await networkApps.clear('instagram')
  })

  test('a blank secret keeps the stored one; a first save needs one', async () => {
    await networkApps.clear('twitter')
    await expect(networkApps.save('twitter', { clientId: 'abc' })).rejects.toThrow('Paste the client secret')
    await networkApps.save('twitter', { clientId: 'abc', clientSecret: 'first' })
    await networkApps.save('twitter', { clientId: 'abc-corrected', clientSecret: '' })
    expect(await networkApps.credentials('twitter')).toMatchObject({ clientId: 'abc-corrected', clientSecret: 'first' })
    await networkApps.clear('twitter')
  })

  test('Settings win over the environment, and clearing them lets the environment apply again', async () => {
    const before = { id: process.env.LINKEDIN_CLIENT_ID, secret: process.env.LINKEDIN_CLIENT_SECRET }
    process.env.LINKEDIN_CLIENT_ID = 'from-env'
    process.env.LINKEDIN_CLIENT_SECRET = 'env-secret'
    await networkApps.save('linkedin', { clientId: 'from-settings', clientSecret: 'settings-secret' })
    expect((await networkApps.credentials('linkedin')).clientId).toBe('from-settings')
    await networkApps.clear('linkedin')
    expect(await networkApps.credentials('linkedin')).toMatchObject({ clientId: 'from-env', source: 'environment' })
    process.env.LINKEDIN_CLIENT_ID = before.id ?? ''
    process.env.LINKEDIN_CLIENT_SECRET = before.secret ?? ''
  })

  test('nonsense is refused with a reason', async () => {
    await expect(networkApps.save('linkedin', { clientId: 'has spaces', clientSecret: 'x' })).rejects.toThrow('no spaces')
    await expect(networkApps.save('linkedin', { clientId: 'ok', clientSecret: 'x', redirectUrl: 'ftp://nope' })).rejects.toThrow('http:// or https://')
  })

  test('the redirect address follows the app address', () => {
    expect(defaultRedirectUrl('twitter', 'https://postline.example.org/')).toBe('https://postline.example.org/api/postline/twitter/callback')
  })
})
