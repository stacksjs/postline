import type { DraftFeedItem } from '../Support/Social/draft-feed'
import { db } from '@stacksjs/database'
import { safeFetch, UnsafeUrlError } from '../Support/Http/safe-fetch'
import { UserFacingError } from '../Support/Http/user-error'
import { feedAddress, parseDraftFeed } from '../Support/Social/draft-feed'
import { ensureAccount, now, uuid } from './Social/support'
import { workspace } from './WorkspaceService'

// SQLite transactions use the synchronous transaction handle for every write.
const database = db as any
const MAX_DRAFTS_PER_CHECK = 30
const keyPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const entryPattern = /^[0-9a-f]{64}$/

export interface DraftFeed {
  uuid: string
  name: string
  url: string
  active: boolean
  initialized: boolean
  lastCheckedAt: string | null
  lastError: string | null
}

export interface ArchivedDraftFeed {
  uuid: string
  name: string
  url: string
  active: boolean
  initialized: boolean
  seen: string[]
}

interface FeedRow {
  id: number
  uuid: string
  name: string
  url: string
  active: 0 | 1
  initialized: 0 | 1
  last_checked_at: string | null
  last_error: string | null
  account_id: number
}

function feedKey(value: unknown): string {
  if (typeof value !== 'string' || !keyPattern.test(value)) throw new UserFacingError('Choose a saved feed.')
  return value.toLowerCase()
}

function feedName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 120) throw new UserFacingError('Give the feed a name of up to 120 characters.')
  return name
}

function toFeed(row: FeedRow): DraftFeed {
  return {
    uuid: row.uuid, name: row.name, url: row.url, active: Boolean(row.active), initialized: Boolean(row.initialized),
    lastCheckedAt: row.last_checked_at, lastError: row.last_error,
  }
}

function recordEntry(tx: typeof database, feedId: number, entryKey: string): boolean {
  const exists = tx.selectFrom('draft_feed_entries').select('id')
    .where('draft_feed_id', '=', feedId).where('entry_key', '=', entryKey).executeTakeFirst()
  if (exists) return false
  tx.insertInto('draft_feed_entries').values({ draft_feed_id: feedId, entry_key: entryKey }).execute()
  return true
}

export function readArchivedDraftFeed(value: unknown): ArchivedDraftFeed {
  if (!value || typeof value !== 'object') throw new UserFacingError('That export contains an invalid draft feed.')
  const { uuid, name, url, active, initialized, seen } = value as Record<string, unknown>
  if (typeof active !== 'boolean' || typeof initialized !== 'boolean'
    || !Array.isArray(seen) || seen.some(key => typeof key !== 'string' || !entryPattern.test(key)))
    throw new UserFacingError('That export contains an invalid draft feed.')
  return { uuid: feedKey(uuid), name: feedName(name), url: feedAddress(url).href, active, initialized, seen: [...new Set(seen)] }
}

async function readFeed(url: string): Promise<DraftFeedItem[]> {
  const result = await safeFetch(url, {
    timeoutMs: 12_000,
    maxBytes: 1024 * 1024,
    headers: { accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, application/json' },
  })
  if (result.status !== 200) throw new UserFacingError(`The feed returned HTTP ${result.status}.`)
  if (result.truncated) throw new UserFacingError('The feed is larger than 1 MB.')
  return parseDraftFeed(result.bytes, result.url)
}

export class DraftFeedService {
  constructor(private readonly read: (url: string) => Promise<DraftFeedItem[]> = readFeed) {}

  private async row(accountId: number, key: unknown): Promise<FeedRow> {
    const row = await database.selectFrom('draft_feeds').selectAll()
      .where('account_id', '=', accountId).where('uuid', '=', feedKey(key)).executeTakeFirst()
    if (!row) throw new UserFacingError('That feed is no longer in this workspace.')
    return row
  }

  async list(): Promise<DraftFeed[]> {
    const rows = await database.selectFrom('draft_feeds').selectAll().where('account_id', '=', await ensureAccount()).orderBy('id', 'asc').execute()
    return rows.map(toFeed)
  }

  async subscribe(name: unknown, address: unknown, includeExisting: boolean) {
    const accountId = await ensureAccount()
    const key = uuid()
    const stamp = now()
    const added = await db.unsafe(`
      INSERT INTO draft_feeds (uuid, name, url, active, initialized, account_id, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (account_id, url) DO NOTHING RETURNING id
    `, [key, feedName(name), feedAddress(address).href, Number(includeExisting), accountId, stamp, stamp])
    if (!added.length) throw new UserFacingError('This address is already in your draft feeds.')
    return this.check(key)
  }

  async setActive(key: unknown, active: boolean): Promise<DraftFeed> {
    const row = await this.row(await ensureAccount(), key)
    const updated = await database.updateTable('draft_feeds').set({ active: Number(active), updated_at: now() })
      .where('id', '=', row.id).returning(['uuid', 'name', 'url', 'active', 'initialized', 'last_checked_at', 'last_error']).executeTakeFirst()
    if (!updated) throw new UserFacingError('That feed is no longer in this workspace.')
    return toFeed(updated)
  }

  async remove(key: unknown): Promise<void> {
    const row = await this.row(await ensureAccount(), key)
    await database.transaction((tx: typeof database) => {
      tx.deleteFrom('draft_feed_entries').where('draft_feed_id', '=', row.id).execute()
      tx.deleteFrom('draft_feeds').where('id', '=', row.id).execute()
    })
  }

  async check(key: unknown): Promise<{ feed: DraftFeed, created: number }> {
    const row = await this.row(await ensureAccount(), key)
    const created = await this.poll(row)
    return { feed: toFeed(await this.row(row.account_id, row.uuid)), created }
  }

  async checkAll(): Promise<{ checked: number, created: number }> {
    const rows: FeedRow[] = await database.selectFrom('draft_feeds').selectAll().where('active', '=', 1).execute()
    let created = 0
    for (let index = 0; index < rows.length; index += 4) {
      const batch = await Promise.all(rows.slice(index, index + 4).map(row => this.poll(row)))
      created += batch.reduce((sum, count) => sum + count, 0)
    }
    return { checked: rows.length, created }
  }

  private async poll(row: FeedRow): Promise<number> {
    if (!row.active) return 0
    try {
      const items = await this.read(row.url)
      const timezone = await workspace.timezone()
      const at = now()
      return await database.transaction((tx: typeof database) => {
        const current: FeedRow | undefined = tx.selectFrom('draft_feeds').selectAll().where('id', '=', row.id).executeTakeFirst()
        if (!current?.active) return 0
        let created = 0
        for (const item of items.toReversed()) {
          if (created >= MAX_DRAFTS_PER_CHECK) break
          if (!recordEntry(tx, current.id, item.key) || !current.initialized) continue

          // The entry receipt and draft commit together. There is no schedule
          // or target until the owner opens the draft and chooses one.
          tx.insertInto('posts').values({
            uuid: uuid(), account_id: current.account_id, title: item.title,
            body: item.link ? `${item.title}\n\n${item.link}` : item.title,
            source: 'import', status: 'draft', timezone, created_at: at, updated_at: at,
          }).execute()
          created++
        }
        tx.updateTable('draft_feeds').set({ initialized: 1, last_checked_at: at, last_error: null, updated_at: at }).where('id', '=', current.id).execute()
        return created
      })
    }
    catch (error) {
      const at = now()
      const message = error instanceof UserFacingError || error instanceof UnsafeUrlError ? error.message : 'Could not check this feed.'
      await database.updateTable('draft_feeds')
        .set({ last_checked_at: at, last_error: message, updated_at: at })
        .where('id', '=', row.id).where('active', '=', 1).execute()
      return 0
    }
  }

  export(accountId: number, tx: typeof database): ArchivedDraftFeed[] {
    const rows: FeedRow[] = tx.selectFrom('draft_feeds').selectAll().where('account_id', '=', accountId).orderBy('id', 'asc').execute()
    return rows.map((row) => {
      const entries: Array<{ entry_key: string }> = tx.selectFrom('draft_feed_entries').select('entry_key').where('draft_feed_id', '=', row.id).execute()
      return { uuid: row.uuid, name: row.name, url: row.url, active: Boolean(row.active), initialized: Boolean(row.initialized), seen: entries.map(entry => entry.entry_key) }
    })
  }

  async restore(accountId: number, feed: ArchivedDraftFeed): Promise<boolean> {
    const at = now()
    return database.transaction((tx: typeof database) => {
      const existing = tx.selectFrom('draft_feeds').select('id')
        .where('account_id', '=', accountId).where('url', '=', feed.url).executeTakeFirst()
      let feedId = existing?.id
      if (!feedId) {
        if (tx.selectFrom('draft_feeds').select('id').where('uuid', '=', feed.uuid).executeTakeFirst()) return false
        tx.insertInto('draft_feeds').values({
          uuid: feed.uuid, name: feed.name, url: feed.url, active: Number(feed.active), initialized: Number(feed.initialized),
          account_id: accountId, created_at: at, updated_at: at,
        }).execute()
        feedId = tx.selectFrom('draft_feeds').select('id').where('uuid', '=', feed.uuid).executeTakeFirstOrThrow().id
      }
      for (const entryKey of feed.seen) recordEntry(tx, feedId, entryKey)
      return !existing
    })
  }
}

export const draftFeeds = new DraftFeedService()
