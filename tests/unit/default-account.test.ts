import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { findIdentityRow, revokeIdentityRow, saveIdentityTokens, setDefaultIdentityRow, upsertIdentityRow } from '../../app/Services/Social/identities'

const database = db as any

/** A network name of its own per test, so rows from other tests cannot be the default. */
async function connect(provider: string, handle: string): Promise<number> {
  const row = await upsertIdentityRow<any>(provider, { externalId: `id-${handle}`, handle }, {
    handle,
    external_id: `id-${handle}`,
    auth_status: 'connected',
    access_token: `token-${handle}`,
  })
  return Number(row.id)
}

async function clear(provider: string): Promise<void> {
  await database.deleteFrom('social_identities').where('provider', '=', provider).execute()
}

describe('the default account on a network', () => {
  test('the first account connected is the default, and a second does not take it', async () => {
    await clear('tiktok')
    const first = await connect('tiktok', 'first')
    const second = await connect('tiktok', 'second')

    expect(Number((await findIdentityRow<any>('tiktok'))!.id)).toBe(first)
    expect(second).not.toBe(first)
    await clear('tiktok')
  })

  test('refreshing a token never changes which account a plain target goes to', async () => {
    await clear('tiktok')
    const first = await connect('tiktok', 'first')
    const second = await connect('tiktok', 'second')

    // What a refresh does: new tokens, and a newer `updated_at` than any other row.
    await saveIdentityTokens((await findIdentityRow('tiktok', second))!, { access_token: 'refreshed', updated_at: '2099-01-01 00:00:00' })

    expect(Number((await findIdentityRow<any>('tiktok'))!.id)).toBe(first)
    await clear('tiktok')
  })

  test('the owner can move it, and exactly one account holds it', async () => {
    await clear('tiktok')
    const first = await connect('tiktok', 'first')
    const second = await connect('tiktok', 'second')

    await setDefaultIdentityRow(second)

    expect(Number((await findIdentityRow<any>('tiktok'))!.id)).toBe(second)
    const flagged = await database.selectFrom('social_identities').select(['id']).where('provider', '=', 'tiktok').where('is_default', '=', true).execute()
    expect(flagged.map((row: any) => Number(row.id))).toEqual([second])
    expect(first).not.toBe(second)
    await clear('tiktok')
  })

  test('disconnecting the default hands it to the next account', async () => {
    await clear('tiktok')
    const first = await connect('tiktok', 'first')
    const second = await connect('tiktok', 'second')

    await revokeIdentityRow('tiktok', first)

    expect(Number((await findIdentityRow<any>('tiktok'))!.id)).toBe(second)
    await expect(setDefaultIdentityRow(first)).rejects.toThrow('not connected')
    await clear('tiktok')
  })
})
