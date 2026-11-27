import type { PostingSlot } from '../Support/Social/posting-slots'
import { db } from '@stacksjs/database'
import { UserFacingError } from '../Support/Http/user-error'
import { crosspostProviders } from './Social/CrosspostService'
import { ensureAccount } from './Social/support'
import { workspace } from './WorkspaceService'

const database = db as any

export function readPostingSlot(value: unknown): PostingSlot {
  const { provider, weekday, minute } = (value ?? {}) as Partial<PostingSlot>
  if (!provider || !crosspostProviders().includes(provider)
    || typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6
    || typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute > 1439)
    throw new UserFacingError('Choose a valid network, day, and time for the posting slot.')
  return { provider, weekday, minute }
}

export function listPostingSlots(accountId: number): Promise<PostingSlot[]>
export function listPostingSlots(accountId: number, tx: typeof database): PostingSlot[]
export function listPostingSlots(accountId: number, tx = database): PostingSlot[] | Promise<PostingSlot[]> {
  return tx.selectFrom('posting_slots').select(['provider', 'weekday', 'minute'])
    .where('account_id', '=', accountId).orderBy('weekday', 'asc').orderBy('minute', 'asc').execute()
}

export async function postingSlotSettings() {
  const accountId = await ensureAccount()
  return { slots: await listPostingSlots(accountId), timezone: await workspace.timezone(), providers: crosspostProviders() }
}

/** Adding the same slot twice is safe, including on import. */
export function addPostingSlot(accountId: number, slot: PostingSlot, tx: typeof database): boolean {
  const existing = slotQuery(accountId, slot, tx).executeTakeFirst()
  if (existing) return false
  tx.insertInto('posting_slots').values({ ...slot, account_id: accountId }).execute()
  return true
}

function slotQuery(accountId: number, slot: PostingSlot, tx: typeof database) {
  return tx.selectFrom('posting_slots').select('id').where('account_id', '=', accountId)
    .where('provider', '=', slot.provider).where('weekday', '=', slot.weekday).where('minute', '=', slot.minute)
}

export async function changePostingSlot(value: unknown, remove: boolean) {
  const slot = readPostingSlot(value)
  const accountId = await ensureAccount()
  return await database.transaction((tx: typeof database) => {
    if (remove) {
      const row = slotQuery(accountId, slot, tx).executeTakeFirst()
      if (row) tx.deleteFrom('posting_slots').where('id', '=', row.id).execute()
    }
    else {
      addPostingSlot(accountId, slot, tx)
    }
    return listPostingSlots(accountId, tx)
  })
}
