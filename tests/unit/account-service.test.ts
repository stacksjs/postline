/**
 * Accounts across networks (#113): listing never carries a token, and
 * disconnecting looks the network up rather than trusting the request.
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { accounts } from '../../app/Services/Social/AccountService'
import { upsertIdentityRow } from '../../app/Services/Social/identities'

const database = db as any

async function connect(handle: string): Promise<number> {
  const row = await upsertIdentityRow<any>('bluesky', { externalId: `did:plc:${handle}`, handle }, {
    handle,
    external_id: `did:plc:${handle}`,
    auth_status: 'connected',
    access_token: `access-${handle}`,
    refresh_token: `refresh-${handle}`,
  })
  return Number(row.id)
}

describe('accounts', () => {
  test('the list holds no tokens', async () => {
    await connect('list-check.bsky.social')
    const listed = await accounts.list()
    const text = JSON.stringify(listed)
    expect(listed.some(account => account.handle === 'list-check.bsky.social')).toBe(true)
    expect(text).not.toContain('access-list-check')
    expect(text).not.toContain('refresh-list-check')
  })

  test('disconnecting keeps the row, so history stays attributed, and drops the tokens', async () => {
    const id = await connect('disconnect-check.bsky.social')
    await accounts.disconnect(id)

    const row = await database.selectFrom('social_identities').selectAll().where('id', '=', id).executeTakeFirst()
    expect(row).toBeTruthy()
    expect(row.auth_status).toBe('revoked')
    expect(row.access_token ?? null).toBeNull()
    expect((await accounts.list()).some(account => account.id === id)).toBe(false)
  })

  test('an account that is gone or already disconnected cannot be disconnected', async () => {
    const id = await connect('twice.bsky.social')
    await accounts.disconnect(id)
    await expect(accounts.disconnect(id)).rejects.toThrow('That account is not connected.')
    await expect(accounts.disconnect(987654321)).rejects.toThrow('That account is not connected.')
  })

  test('the account marked default is the one returned as default', async () => {
    await connect('first-default.bsky.social')
    const second = await connect('second-default.bsky.social')
    const marked = await accounts.makeDefault(second)
    expect(marked.isDefault).toBe(true)
    expect((await accounts.list()).find(account => account.isDefault && account.provider === 'bluesky')?.id).toBe(second)
  })
})
