/**
 * The account's publication: its identity on the Open Times network.
 *
 * Every Discover entry belongs to one of these, so `ensurePublication` is
 * called on the publish path rather than only from settings. A writer who
 * never opened the publication settings still gets a coherent row, seeded
 * from the account, instead of publishing failing on a missing foreign key.
 *
 * Listing stays opt-in throughout: `ensurePublication` creates the row unlisted
 * and only `save` can change that, so nothing here can put a publication into
 * the index as a side effect of publishing.
 */

import { db } from '@stacksjs/database'
import { ensureAccount, now, uuid } from './Social/support'

const database = db as any

export interface PublicationInput {
  name?: unknown
  tagline?: unknown
  description?: unknown
  domain?: unknown
  authorName?: unknown
  listed?: unknown
}

export interface PublicationView {
  id: number
  name: string
  slug: string
  tagline: string | null
  description: string | null
  domain: string | null
  avatarUrl: string | null
  authorName: string | null
  listed: boolean
  subscriberCount: number
  entryCount: number
  lastPublishedAt: string | null
}

/** URL-safe slug, matching how `BlogService` slugs a post title. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .slice(0, 120)
    .replace(/^-+|-+$/g, '') || 'publication'
}

export function publicationRow(row: any): PublicationView {
  return {
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    tagline: row.tagline || null,
    description: row.description || null,
    domain: row.domain || null,
    avatarUrl: row.avatar_url || null,
    authorName: row.author_name || null,
    listed: Boolean(Number(row.listed || 0)),
    subscriberCount: Number(row.subscriber_count || 0),
    entryCount: Number(row.entry_count || 0),
    lastPublishedAt: row.last_published_at || null,
  }
}

export class PublicationService {
  /** The account's publication, creating an unlisted one on first use. */
  async ensurePublication(): Promise<PublicationView> {
    const existing = await database
      .selectFrom('publications')
      .selectAll()
      .orderBy('id', 'asc')
      .executeTakeFirst()

    if (existing) return publicationRow(existing)

    const accountId = await ensureAccount()
    const account = await database
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', accountId)
      .executeTakeFirst()

    const name = String(account?.workspace_name || account?.name || 'My Publication').trim()
    const publicationUuid = uuid()

    await database.insertInto('publications').values({
      uuid: publicationUuid,
      name,
      slug: await this.uniqueSlug(slugify(name)),
      tagline: null,
      description: null,
      domain: null,
      avatar_url: null,
      author_name: account?.name || null,
      // Unlisted until the owner says otherwise. Creating a publication is a
      // side effect of publishing; being indexed never is.
      listed: 0,
      subscriber_count: 0,
      entry_count: 0,
      last_published_at: null,
      account_id: accountId,
      created_at: now(),
      updated_at: now(),
    }).execute()

    return publicationRow(await database
      .selectFrom('publications')
      .selectAll()
      .where('uuid', '=', publicationUuid)
      .executeTakeFirstOrThrow())
  }

  async save(input: PublicationInput): Promise<PublicationView> {
    const current = await this.ensurePublication()
    const values: Record<string, unknown> = { updated_at: now() }

    if (input.name !== undefined) {
      const name = String(input.name || '').trim()
      if (name.length < 2) throw new Error('Give your publication a name of at least two characters.')
      values.name = name.slice(0, 120)
      // The slug follows the name only while the publication is unlisted.
      // Once it is in the index other people link to it, and silently moving
      // it would break every one of those links.
      if (!current.listed) values.slug = await this.uniqueSlug(slugify(name), current.id)
    }

    if (input.tagline !== undefined) values.tagline = String(input.tagline || '').trim().slice(0, 200) || null
    if (input.description !== undefined) values.description = String(input.description || '').trim().slice(0, 2000) || null
    if (input.authorName !== undefined) values.author_name = String(input.authorName || '').trim().slice(0, 120) || null

    if (input.domain !== undefined) {
      const domain = String(input.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase()
      if (domain && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain))
        throw new Error('That does not look like a domain. Use a bare hostname such as example.com.')
      values.domain = domain.slice(0, 255) || null
    }

    if (input.listed !== undefined) {
      const listed = input.listed === true || input.listed === 1 || input.listed === '1' || input.listed === 'true'
      // Listing puts the publication in front of other people's readers, so it
      // needs enough to be worth showing them.
      const name = String(values.name ?? current.name)
      const tagline = values.tagline === undefined ? current.tagline : values.tagline
      if (listed && (!name.trim() || !String(tagline || '').trim()))
        throw new Error('Add a name and a tagline before listing your publication in Discover.')
      values.listed = listed ? 1 : 0
    }

    await database.updateTable('publications').set(values).where('id', '=', current.id).execute()

    return publicationRow(await database
      .selectFrom('publications')
      .selectAll()
      .where('id', '=', current.id)
      .executeTakeFirstOrThrow())
  }

  /**
   * Refresh the denormalized counters after a publish.
   *
   * Recomputed from the entries table rather than incremented, so a failed
   * publish, a deleted entry or a replayed job cannot drift the count. It is
   * two aggregate reads on a table indexed by publication, which is cheap
   * enough to prefer correctness here.
   */
  async refreshCounters(publicationId: number): Promise<void> {
    const entries = await database
      .selectFrom('discover_entries')
      .select(['published_at'])
      .where('publication_id', '=', publicationId)
      .where('status', '=', 'visible')
      .orderBy('published_at', 'desc')
      .execute()

    await database.updateTable('publications').set({
      entry_count: entries.length,
      last_published_at: entries[0]?.published_at || null,
      updated_at: now(),
    }).where('id', '=', publicationId).execute()
  }

  private async uniqueSlug(base: string, ignoreId = 0): Promise<string> {
    let candidate = base
    for (let attempt = 2; attempt < 50; attempt++) {
      let query = database.selectFrom('publications').select(['id']).where('slug', '=', candidate)
      if (ignoreId) query = query.where('id', '!=', ignoreId)
      const clash = await query.executeTakeFirst()
      if (!clash) return candidate
      candidate = `${base}-${attempt}`
    }

    return `${base}-${uuid().slice(0, 8)}`
  }
}

export const publications = new PublicationService()
