/**
 * LinkedIn company Pages (#130): opt-in on the owner's app, the scopes that
 * asks for, one account per Page on the member's token, and one renewal for
 * the member and their Pages together.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { networkApps } from '../../app/Services/NetworkAppService'
import { linkedInScopes, linkedin } from '../../app/Services/Social/LinkedInService'
import { findIdentityRow, listIdentityRows, upsertIdentityRow } from '../../app/Services/Social/identities'

const database = db as any
const driver = (linkedin as unknown as { driver: Record<string, unknown> }).driver
const originals = { listOrganizations: driver.listOrganizations, refreshAccessToken: driver.refreshAccessToken }

afterEach(async () => {
  Object.assign(driver, originals)
  await database.deleteFrom('social_identities').where('provider', '=', 'linkedin').execute()
  await networkApps.clear('linkedin')
})

describe('LinkedIn company Pages', () => {
  test('are off unless the owner turns them on, and only on LinkedIn', async () => {
    await networkApps.save('linkedin', { clientId: 'li-app', clientSecret: 'li-secret' })
    expect((await networkApps.credentials('linkedin')).organizationPages).toBe(false)

    await networkApps.save('linkedin', { clientId: 'li-app', organizationPages: true })
    expect((await networkApps.credentials('linkedin')).organizationPages).toBe(true)
    // A save without the switch keeps it.
    await networkApps.save('linkedin', { clientId: 'li-app-renamed' })
    expect((await networkApps.summary()).find(app => app.provider === 'linkedin')?.organizationPages).toBe(true)

    await networkApps.save('threads', { clientId: 'th-app', clientSecret: 'th-secret', organizationPages: true })
    expect((await networkApps.credentials('threads')).organizationPages).toBe(false)
    await networkApps.clear('threads')
  })

  test('ask LinkedIn for posting as a Page and listing Pages only when on', async () => {
    expect(linkedInScopes(false)).toEqual(['openid', 'profile', 'w_member_social'])
    expect(linkedInScopes(true)).toEqual(['openid', 'profile', 'w_member_social', 'w_organization_social', 'r_organization_admin'])

    const scope = async (): Promise<string> => new URL(await linkedin.getAuthUrl()).searchParams.get('scope') ?? ''
    await networkApps.save('linkedin', { clientId: 'li-app', clientSecret: 'li-secret', organizationPages: false })
    expect(await scope()).not.toContain('w_organization_social')
    await networkApps.save('linkedin', { clientId: 'li-app', organizationPages: true })
    expect(await scope()).toContain('w_organization_social')
    expect(await scope()).toContain('r_organization_admin')
  })

  test('each Page becomes an account posting as the organization, on the member\'s token', async () => {
    driver.listOrganizations = async () => [
      { urn: 'urn:li:organization:111', id: '111', role: 'ADMINISTRATOR', name: 'Acme' },
      { urn: 'urn:li:organization:222', id: '222', role: 'CONTENT_ADMINISTRATOR' },
    ]
    expect(await linkedin.connectPages({ accessToken: 'member-token', refreshToken: 'member-refresh', expiresIn: 3600 })).toBe(2)

    const rows = await listIdentityRows<any>('linkedin')
    const acme = rows.find(row => row.external_id === 'urn:li:organization:111')
    expect(acme?.handle).toBe('Acme')
    expect(acme?.access_token).toBe('member-token')
    expect(rows.find(row => row.external_id === 'urn:li:organization:222')?.handle).toBe('Page 222')
  })

  test('a token that cannot list Pages leaves the sign-in as it was', async () => {
    driver.listOrganizations = async () => { throw new Error('no r_organization_admin') }
    expect(await linkedin.connectPages({ accessToken: 'member-token' })).toBe(0)
    expect(await listIdentityRows<any>('linkedin')).toHaveLength(0)
  })

  test('renewing the member renews their Pages too', async () => {
    await networkApps.save('linkedin', { clientId: 'li-app', clientSecret: 'li-secret' })
    const soon = new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' ')
    const save = async (urn: string) => Number((await upsertIdentityRow<any>('linkedin', { externalId: urn }, {
      handle: urn, external_id: urn, auth_status: 'connected', access_token: 'old-access', refresh_token: 'shared-refresh', token_expires_at: soon,
    })).id)
    const member = await save('urn:li:person:abc')
    const page = await save('urn:li:organization:333')
    driver.refreshAccessToken = async () => ({ accessToken: 'new-access', expiresIn: 5_184_000 })

    expect(await linkedin.keepAlive()).toBeGreaterThan(0)
    expect((await findIdentityRow<any>('linkedin', member))?.access_token).toBe('new-access')
    expect((await findIdentityRow<any>('linkedin', page))?.access_token).toBe('new-access')
  })
})
