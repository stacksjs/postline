import type { IdentityAuthStatus } from '../../app/Support/Social/accounts'
/**
 * Network tokens are stored sealed, and everything outside the identities
 * module still sees them plain.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { findIdentityRow, listIdentityRows, resetTokenSealing, revokeIdentityRow, saveIdentityTokens, sealStoredTokens, upsertIdentityRow } from '../../app/Services/Social/identities'
import { isSealed, openToken, sealToken } from '../../app/Support/Social/token-vault'

const database = db as any

interface Row { id: number, provider: string, handle: string, auth_status: IdentityAuthStatus, access_token: string | null, refresh_token: string | null }

async function stored(id: number): Promise<{ access_token: string | null, refresh_token: string | null }> {
  return await database.selectFrom('social_identities').select(['access_token', 'refresh_token']).where('id', '=', id).executeTakeFirstOrThrow()
}

let counter = 0
function handle(): string {
  return `vault-${Date.now()}-${counter++}.example`
}

beforeEach(() => {
  resetTokenSealing()
})

describe('sealToken / openToken', () => {
  test('a sealed token is not the token, and opens back to it', async () => {
    const sealed = await sealToken('secret-token-value')

    expect(isSealed(sealed)).toBe(true)
    expect(sealed).not.toContain('secret-token-value')
    expect(await openToken(sealed)).toBe('secret-token-value')
  })

  test('sealing twice gives different ciphertext', async () => {
    expect(await sealToken('same')).not.toBe(await sealToken('same'))
  })

  test('an already sealed value is left alone', async () => {
    const sealed = await sealToken('once')

    expect(await sealToken(sealed)).toBe(sealed)
  })

  test('empty stays empty', async () => {
    expect(await sealToken(null)).toBeNull()
    expect(await sealToken('')).toBeNull()
    expect(await openToken(null)).toBeNull()
  })

  test('a value stored before sealing existed is passed through', async () => {
    expect(await openToken('plain-legacy-token')).toBe('plain-legacy-token')
  })

  test('a sealed value that cannot be read is an error, never returned as a token', async () => {
    await expect(openToken('enc:v1:not-real-ciphertext')).rejects.toThrow(/Reconnect/)
  })
})

describe('tokens in the identities table', () => {
  test('a connected account is stored sealed and read back plain', async () => {
    const row = await upsertIdentityRow<Row>('mastodon', { handle: handle() }, {
      handle: handle(),
      auth_status: 'connected',
      access_token: 'access-plain',
      refresh_token: 'refresh-plain',
    })

    expect(row.access_token).toBe('access-plain')
    expect(row.refresh_token).toBe('refresh-plain')

    const onDisk = await stored(row.id)
    expect(isSealed(onDisk.access_token)).toBe(true)
    expect(isSealed(onDisk.refresh_token)).toBe(true)
    expect(onDisk.access_token).not.toContain('access-plain')
  })

  test('lookups return plain tokens', async () => {
    const h = handle()
    const row = await upsertIdentityRow<Row>('mastodon', { handle: h }, { handle: h, auth_status: 'connected', access_token: 'lookup-plain' })

    expect((await findIdentityRow<Row>('mastodon', row.id))?.access_token).toBe('lookup-plain')
    expect((await listIdentityRows<Row>('mastodon')).find(r => r.id === row.id)?.access_token).toBe('lookup-plain')
  })

  test('a refreshed token is stored sealed', async () => {
    const h = handle()
    const row = await upsertIdentityRow<Row>('twitter', { handle: h }, { handle: h, auth_status: 'connected', access_token: 'old' })

    await saveIdentityTokens(row.id, { access_token: 'rotated-access', refresh_token: 'rotated-refresh' })

    const onDisk = await stored(row.id)
    expect(isSealed(onDisk.access_token)).toBe(true)
    expect(onDisk.access_token).not.toContain('rotated-access')
    expect((await findIdentityRow<Row>('twitter', row.id))?.refresh_token).toBe('rotated-refresh')
  })

  test('an install that stored tokens in the clear is sealed on first use', async () => {
    const h = handle()
    await database.insertInto('social_identities').values({
      uuid: crypto.randomUUID(),
      handle: h,
      provider: 'linkedin',
      auth_status: 'connected',
      access_token: 'legacy-plain-access',
      refresh_token: 'legacy-plain-refresh',
    }).execute()
    const before = await database.selectFrom('social_identities').select(['id', 'access_token']).where('handle', '=', h).executeTakeFirstOrThrow()
    expect(before.access_token).toBe('legacy-plain-access')

    const rewritten = await sealStoredTokens()

    expect(rewritten).toBeGreaterThanOrEqual(1)
    const onDisk = await stored(before.id)
    expect(isSealed(onDisk.access_token)).toBe(true)
    expect(isSealed(onDisk.refresh_token)).toBe(true)
    expect((await findIdentityRow<Row>('linkedin', before.id))?.access_token).toBe('legacy-plain-access')
  })

  test('sealing again changes nothing', async () => {
    await sealStoredTokens()
    resetTokenSealing()

    expect(await sealStoredTokens()).toBe(0)
  })

  test('a token this install cannot read reads as absent, so the account needs reconnecting', async () => {
    const h = handle()
    await database.insertInto('social_identities').values({
      uuid: crypto.randomUUID(),
      handle: h,
      provider: 'threads',
      auth_status: 'connected',
      access_token: 'enc:v1:sealed-with-another-key',
    }).execute()
    const inserted = await database.selectFrom('social_identities').select(['id']).where('handle', '=', h).executeTakeFirstOrThrow()

    expect((await findIdentityRow<Row>('threads', inserted.id))?.access_token).toBeNull()
  })

  test('disconnecting still clears the tokens', async () => {
    const h = handle()
    const row = await upsertIdentityRow<Row>('mastodon', { handle: h }, { handle: h, auth_status: 'connected', access_token: 'to-be-dropped' })

    await revokeIdentityRow('mastodon', row.id)

    expect((await stored(row.id)).access_token).toBeNull()
  })
})
