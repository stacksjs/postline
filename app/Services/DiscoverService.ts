/**
 * The Discover feeds.
 *
 * Writes come from two places and both go through `record`: the short-form
 * crosspost target (`OpenTimesService`) and the long-form blog publish. Keeping
 * one write path is what lets ranking, deduplication, counter refresh and the
 * realtime broadcast happen once rather than twice, slightly differently.
 *
 * Reads never recompute a rank. `record` and `rerank` write `score`, and the
 * feed is an indexed sort on it, so a feed page costs one query regardless of
 * how much of the network it is ranking.
 */

import type { DiscoverForm } from '../Support/Social/discover'
import { db } from '@stacksjs/database'
import { broadcastDiscoverEntry } from '../Support/Realtime/discover'
import { ageInHours, excerptOf, isDiscoverForm, rankEntry } from '../Support/Social/discover'
import { publications } from './PublicationService'
import { now, uuid } from './Social/support'

const database = db as any

/** Feed page size. */
const FEED_LIMIT = 50

export interface DiscoverEntryInput {
  form: DiscoverForm
  /** Stable per-publication id for the source, so a republish updates. */
  sourceKey: string
  title?: string | null
  body: string
  url?: string | null
  postId?: number | null
  publishedAt?: string | null
}

export interface DiscoverEntryView {
  id: number
  form: DiscoverForm
  title: string | null
  body: string
  excerpt: string
  url: string | null
  publishedAt: string
  score: number
  readCount: number
  conversionCount: number
  publication: {
    id: number
    name: string
    slug: string
    tagline: string | null
    authorName: string | null
    domain: string | null
    subscriberCount: number
    listed: boolean
  } | null
}

function sqliteTimestamp(value: unknown): string {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? now() : date.toISOString().slice(0, 19).replace('T', ' ')
}

export class DiscoverService {
  /**
   * Write (or update) one entry and announce it.
   *
   * Idempotent on `(publication, form, sourceKey)`: publishing the same post
   * twice updates the entry rather than adding a second one, which is what
   * makes a retried publish safe.
   *
   * Returns null when the publication is unlisted, because an unlisted
   * publication has not agreed to appear in anyone's feed. The caller still
   * treats that as a successful publish, since the post itself went out.
   */
  async record(input: DiscoverEntryInput): Promise<DiscoverEntryView | null> {
    const publication = await publications.ensurePublication()
    if (!publication.listed) return null

    const body = String(input.body || '').trim()
    if (!body) throw new Error('A Discover entry needs a body.')

    const publishedAt = sqliteTimestamp(input.publishedAt || now())
    const existing = await database
      .selectFrom('discover_entries')
      .selectAll()
      .where('publication_id', '=', publication.id)
      .where('form', '=', input.form)
      .where('source_key', '=', input.sourceKey)
      .executeTakeFirst()

    const values: Record<string, unknown> = {
      form: input.form,
      source_key: input.sourceKey,
      title: input.title ? String(input.title).slice(0, 300) : null,
      body: body.slice(0, 10000),
      url: input.url ? String(input.url).slice(0, 1000) : null,
      status: 'visible',
      published_at: publishedAt,
      publication_id: publication.id,
      post_id: input.postId || null,
      updated_at: now(),
    }

    let entryId: number
    if (existing) {
      await database.updateTable('discover_entries').set(values).where('id', '=', existing.id).execute()
      entryId = Number(existing.id)
    }
    else {
      const entryUuid = uuid()
      await database.insertInto('discover_entries').values({
        ...values,
        uuid: entryUuid,
        score: 0,
        read_count: 0,
        conversion_count: 0,
        created_at: now(),
      }).execute()

      entryId = Number((await database
        .selectFrom('discover_entries')
        .select(['id'])
        .where('uuid', '=', entryUuid)
        .executeTakeFirstOrThrow()).id)
    }

    await this.rerankEntry(entryId)
    await publications.refreshCounters(publication.id)

    const view = await this.find(entryId)
    if (view) broadcastDiscoverEntry(existing ? 'EntryUpdated' : 'EntryPublished', { ...view, id: view.id, form: view.form })

    return view
  }

  /** One feed, ranked. */
  async feed(form: unknown, options: { limit?: number } = {}): Promise<{ form: DiscoverForm, entries: DiscoverEntryView[] }> {
    const resolved: DiscoverForm = isDiscoverForm(form) ? form : 'short'
    const rows = await database
      .selectFrom('discover_entries')
      .selectAll()
      .where('form', '=', resolved)
      .where('status', '=', 'visible')
      .orderBy('score', 'desc')
      .orderBy('published_at', 'desc')
      .limit(Math.min(Math.max(Number(options.limit) || FEED_LIMIT, 1), FEED_LIMIT))
      .execute()

    return { form: resolved, entries: await this.hydrate(rows) }
  }

  /** Both feeds plus the listed publications, for the Discover page load. */
  async overview() {
    const [short, long, listed] = await Promise.all([
      this.feed('short'),
      this.feed('long'),
      this.listedPublications(),
    ])

    return {
      short: short.entries,
      long: long.entries,
      publications: listed,
      publication: await publications.ensurePublication(),
    }
  }

  /** Publications in the index, most subscribed first. */
  async listedPublications(limit = 24) {
    const rows = await database
      .selectFrom('publications')
      .selectAll()
      .where('listed', '=', 1)
      .orderBy('subscriber_count', 'desc')
      .orderBy('last_published_at', 'desc')
      .limit(limit)
      .execute()

    const recommendations = await database
      .selectFrom('publication_recommendations')
      .selectAll()
      .execute()

    return rows.map((row: any) => ({
      id: Number(row.id),
      name: String(row.name),
      slug: String(row.slug),
      tagline: row.tagline || null,
      authorName: row.author_name || null,
      domain: row.domain || null,
      subscriberCount: Number(row.subscriber_count || 0),
      entryCount: Number(row.entry_count || 0),
      lastPublishedAt: row.last_published_at || null,
      recommendedBy: recommendations.filter((rec: any) => String(rec.target_slug) === String(row.slug)).length,
    }))
  }

  /**
   * Count a read against an entry and rerank it.
   *
   * Deliberately not deduplicated per reader: Discover has no reader identity
   * to deduplicate against, and inventing one to sharpen a ranking signal
   * would mean tracking people who are only reading a public feed.
   */
  async recordRead(entryId: number): Promise<void> {
    const entry = await database
      .selectFrom('discover_entries')
      .select(['id', 'read_count'])
      .where('id', '=', entryId)
      .where('status', '=', 'visible')
      .executeTakeFirst()

    if (!entry) return

    await database.updateTable('discover_entries').set({
      read_count: Number(entry.read_count || 0) + 1,
      updated_at: now(),
    }).where('id', '=', entryId).execute()

    await this.rerankEntry(entryId)
  }

  /** Credit an entry with winning a subscription, and rerank it. */
  async recordConversion(entryId: number): Promise<void> {
    const entry = await database
      .selectFrom('discover_entries')
      .select(['id', 'conversion_count'])
      .where('id', '=', entryId)
      .executeTakeFirst()

    if (!entry) return

    await database.updateTable('discover_entries').set({
      conversion_count: Number(entry.conversion_count || 0) + 1,
      updated_at: now(),
    }).where('id', '=', entryId).execute()

    await this.rerankEntry(entryId)
  }

  /** Take an entry out of the feeds without deleting the post behind it. */
  async setStatus(entryId: number, status: 'visible' | 'hidden'): Promise<void> {
    const entry = await database
      .selectFrom('discover_entries')
      .selectAll()
      .where('id', '=', entryId)
      .executeTakeFirst()

    if (!entry) throw new Error('That Discover entry does not exist.')

    await database.updateTable('discover_entries')
      .set({ status, updated_at: now() })
      .where('id', '=', entryId)
      .execute()

    await publications.refreshCounters(Number(entry.publication_id))
    broadcastDiscoverEntry(status === 'visible' ? 'EntryPublished' : 'EntryRemoved', {
      id: entryId,
      form: String(entry.form) as DiscoverForm,
    })
  }

  /**
   * Rerank every visible entry.
   *
   * Scores decay with age, so a feed that is never rewritten slowly becomes a
   * ranking of who published most recently rather than of what is worth
   * reading. The scheduler runs this; nothing on a request path does.
   */
  async rerankAll(): Promise<{ reranked: number }> {
    const rows = await database
      .selectFrom('discover_entries')
      .select(['id'])
      .where('status', '=', 'visible')
      .execute()

    for (const row of rows) await this.rerankEntry(Number(row.id))

    return { reranked: rows.length }
  }

  private async rerankEntry(entryId: number): Promise<void> {
    const entry = await database
      .selectFrom('discover_entries')
      .selectAll()
      .where('id', '=', entryId)
      .executeTakeFirst()

    if (!entry) return

    const publication = await database
      .selectFrom('publications')
      .selectAll()
      .where('id', '=', entry.publication_id)
      .executeTakeFirst()

    const recommendations = publication
      ? await database
          .selectFrom('publication_recommendations')
          .select(['id'])
          .where('target_slug', '=', publication.slug)
          .execute()
      : []

    const score = rankEntry({
      subscriberCount: Number(publication?.subscriber_count || 0),
      readCount: Number(entry.read_count || 0),
      conversionCount: Number(entry.conversion_count || 0),
      recommendationCount: recommendations.length,
      ageHours: ageInHours(entry.published_at),
    })

    await database.updateTable('discover_entries')
      .set({ score })
      .where('id', '=', entryId)
      .execute()
  }

  private async find(entryId: number): Promise<DiscoverEntryView | null> {
    const row = await database
      .selectFrom('discover_entries')
      .selectAll()
      .where('id', '=', entryId)
      .executeTakeFirst()

    if (!row) return null

    return (await this.hydrate([row]))[0] || null
  }

  /**
   * Attach publications to entries in one query rather than one per row.
   * A feed page is 50 entries from a handful of publications, so the join is
   * done here in a map instead of as 50 round trips.
   */
  private async hydrate(rows: any[]): Promise<DiscoverEntryView[]> {
    if (!rows.length) return []

    const publicationIds = [...new Set(rows.map(row => Number(row.publication_id)).filter(Boolean))]
    const owners = publicationIds.length
      ? await database.selectFrom('publications').selectAll().where('id', 'in', publicationIds).execute()
      : []
    const byId = new Map(owners.map((owner: any) => [Number(owner.id), owner]))

    return rows.map((row) => {
      const owner: any = byId.get(Number(row.publication_id))
      const body = String(row.body || '')

      return {
        id: Number(row.id),
        form: String(row.form) as DiscoverForm,
        title: row.title || null,
        body,
        excerpt: excerptOf(body, row.form === 'long' ? 280 : 400),
        url: row.url || null,
        publishedAt: row.published_at,
        score: Number(row.score || 0),
        readCount: Number(row.read_count || 0),
        conversionCount: Number(row.conversion_count || 0),
        publication: owner
          ? {
              id: Number(owner.id),
              name: String(owner.name),
              slug: String(owner.slug),
              tagline: owner.tagline || null,
              authorName: owner.author_name || null,
              domain: owner.domain || null,
              subscriberCount: Number(owner.subscriber_count || 0),
              listed: Boolean(Number(owner.listed || 0)),
            }
          : null,
      }
    })
  }
}

export const discover = new DiscoverService()
