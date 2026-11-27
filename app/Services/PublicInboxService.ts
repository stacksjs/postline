import type { PublicInboxProvider, PublicNotification } from './Social/public-notifications'
import { db } from '@stacksjs/database'
import { publicMessage } from '../Support/Http/action-error'
import { isUsableIdentity } from '../Support/Social/accounts'
import { pageOffset } from './DirectMessageService'
import { daysAgo, KEEP_DAYS } from './HousekeepingService'
import { listIdentityRows } from './Social/identities'
import { PUBLIC_INBOX_PROVIDERS, publicNotifications } from './Social/public-notifications'
import { now, uuid } from './Social/support'

const PAGE_SIZE = 30
const MAX_SYNC_PAGES = 12

export class PublicInboxService {
  constructor(private readonly loadPage = publicNotifications) {}

  async sync() {
    let added = 0
    const errors: Array<{ provider: PublicInboxProvider, handle: string, message: string }> = []
    for (const provider of PUBLIC_INBOX_PROVIDERS) {
      for (const identity of await listIdentityRows(provider)) {
        if (!isUsableIdentity(identity)) continue
        try {
          added += await this.syncIdentity(provider, Number(identity.id))
        }
        catch (error) {
          errors.push({ provider, handle: identity.handle, message: publicMessage(error, 'Could not sync public activity. Try again from Inbox.') })
        }
      }
    }
    return { added, errors }
  }

  private async syncIdentity(provider: PublicInboxProvider, identityId: number): Promise<number> {
    const hasHistory = await db.selectFrom('inbox_mentions').select('id').where('social_identity_id', '=', identityId).executeTakeFirst()
    const cutoff = daysAgo(KEEP_DAYS.publicInbox)
    const pending = new Map<string, PublicNotification>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < MAX_SYNC_PAGES; page++) {
      const result = await this.loadPage(provider, identityId, cursor)
      const items = result.items.flatMap((item) => {
        const date = new Date(item.postedAt)
        if (Number.isNaN(date.getTime()) || item.remoteId.length > 700 || item.url.length > 1000) return []
        return [{ ...item, postedAt: date.toISOString().slice(0, 19).replace('T', ' ') }]
      })
      const recent = items.filter(item => item.postedAt >= cutoff)
      for (const item of recent) pending.set(item.remoteId, item)

      // Fetch until the last successful scan's history is reached. Persist
      // the batch together, so a failed older page cannot hide a gap on retry.
      // The page cap defines how far back to look after an extended outage.
      const overlap = hasHistory && recent.length > 0 && await db.selectFrom('inbox_mentions').select('id')
        .where('social_identity_id', '=', identityId).where('remote_id', 'in', recent.map(item => item.remoteId)).executeTakeFirst()
      const olderThanRetention = items.length > 0 && items.every(item => item.postedAt < cutoff)
      if (!result.next || overlap || olderThanRetention || (!hasHistory && pending.size >= PAGE_SIZE)) break
      if (cursors.has(result.next))
        throw new Error('The network returned a repeated notification page. Try again from Inbox.')
      cursors.add(result.next)
      cursor = result.next
    }

    if (!pending.size) return 0
    const entries = [...pending.values()]
    const timestamp = now()
    const inserted = await db.unsafe(
      `INSERT INTO inbox_mentions
        (uuid, social_identity_id, remote_id, kind, author, body, url, posted_at, created_at, updated_at)
        VALUES ${entries.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
        ON CONFLICT (social_identity_id, remote_id) DO NOTHING RETURNING id`,
      entries.flatMap(item => [uuid(), identityId, item.remoteId, item.kind, item.author.slice(0, 255),
        item.body.slice(0, 10000), item.url, item.postedAt, timestamp, timestamp]),
    )
    return inserted.length
  }

  async list(offset = 0) {
    const start = pageOffset(offset)
    const rows = await db.unsafe(
      `SELECT entry.id, entry.kind, entry.author, entry.body, entry.url, entry.posted_at, entry.read_at,
        identity.provider, identity.handle AS account
       FROM inbox_mentions entry JOIN social_identities identity ON identity.id = entry.social_identity_id
       ORDER BY entry.posted_at DESC, entry.id DESC LIMIT ? OFFSET ?`, [PAGE_SIZE + 1, start],
    )
    return {
      entries: rows.slice(0, PAGE_SIZE).map(row => ({
        id: Number(row.id), kind: String(row.kind), author: String(row.author), body: String(row.body ?? ''),
        url: String(row.url), postedAt: String(row.posted_at), read: Boolean(row.read_at),
        provider: String(row.provider), account: String(row.account),
      })),
      nextOffset: rows.length > PAGE_SIZE ? start + PAGE_SIZE : null,
    }
  }

  async markRead(id: number): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Choose a reply or mention to mark read.')
    await db.updateTable('inbox_mentions').set({ read_at: now() }).where('id', '=', id).where('read_at', 'is', null).execute()
  }
}

export const publicInbox = new PublicInboxService()
