/**
 * Bring a publication over from somewhere else.
 *
 * Leaving a platform normally means abandoning the archive and asking every
 * reader to sign up again. This moves the posts and the list together, and
 * reports exactly what it did rather than claiming success and leaving you to
 * discover what did not arrive.
 *
 * Two rules shape the whole file. Nothing is destructive: an import can be run
 * twice and the second run updates rather than duplicates, because the first
 * run failing halfway is the normal case. And nothing is silent: every skipped
 * row is counted and the first few reasons are returned, since "imported 1,482
 * of 1,500" with no explanation is worse than an error.
 *
 * Imported readers arrive already confirmed. They opted in on the platform
 * they are coming from, and re-confirming an existing list is how a
 * publication loses most of it.
 */

import { db } from '@stacksjs/database'
import { discover } from './DiscoverService'
import { publications } from './PublicationService'
import { now, uuid } from './Social/support'
import { isEmail, normalizeEmail, subscribers } from './SubscriberService'

const database = db as any

/** Cap per run, so a pasted file cannot become an unbounded write loop. */
const MAX_ROWS = 5000

export interface ImportReport {
  imported: number
  updated: number
  skipped: number
  /** The first few reasons, so a bad file is diagnosable without a log. */
  reasons: string[]
}

export interface SubscriberImportRow {
  email?: unknown
  name?: unknown
  plan?: unknown
  status?: unknown
  createdAt?: unknown
}

export interface PostImportRow {
  title?: unknown
  body?: unknown
  slug?: unknown
  publishedAt?: unknown
  url?: unknown
}

/**
 * Parse CSV into rows keyed by header.
 *
 * Written here rather than pulled in as a dependency: exports from publishing
 * platforms are small, well-formed files, and this handles the one thing that
 * actually varies between them, which is quoted fields containing commas and
 * escaped quotes.
 */
export function parseCsv(input: string): Array<Record<string, string>> {
  const text = String(input || '').replace(/\r\n/g, '\n').trim()
  if (!text) return []

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[index + 1] === '"') {
          field += '"'
          index++
        }
        else {
          quoted = false
        }
      }
      else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    }
    else if (char === ',') {
      row.push(field)
      field = ''
    }
    else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    }
    else {
      field += char
    }
  }

  row.push(field)
  rows.push(row)

  const [header, ...body] = rows
  if (!header) return []

  const keys = header.map(key => key.trim().toLowerCase())

  return body
    .filter(cells => cells.some(cell => cell.trim()))
    .map((cells) => {
      const record: Record<string, string> = {}
      keys.forEach((key, index) => { record[key] = (cells[index] ?? '').trim() })
      return record
    })
}

/**
 * Map a CSV row onto our subscriber shape.
 *
 * Column names differ per platform, so several aliases are accepted for each
 * field. Anything unrecognised is left alone rather than guessed at.
 */
export function subscriberFromCsvRow(row: Record<string, string>): SubscriberImportRow {
  return {
    email: row.email || row.email_address || row['email address'] || '',
    name: row.name || row.full_name || row['full name'] || row.first_name || '',
    plan: row.plan || row.type || row.subscription || '',
    status: row.status || row.state || '',
    createdAt: row.created_at || row.subscribed_at || row.date || '',
  }
}

export class ImportService {
  /**
   * Import readers.
   *
   * Existing addresses are updated, never duplicated, so a re-run after a
   * partial failure converges instead of doubling the list. A row that is
   * already unsubscribed here stays unsubscribed: an import must not
   * resurrect somebody who left.
   */
  async importSubscribers(rows: SubscriberImportRow[]): Promise<ImportReport> {
    const publication = await publications.ensurePublication()
    const report: ImportReport = { imported: 0, updated: 0, skipped: 0, reasons: [] }
    const seen = new Set<string>()

    const addReason = (reason: string) => {
      if (report.reasons.length < 10 && !report.reasons.includes(reason)) report.reasons.push(reason)
    }

    for (const row of rows.slice(0, MAX_ROWS)) {
      const email = normalizeEmail(row.email)

      if (!isEmail(email)) {
        report.skipped++
        addReason(`Not a valid email address: ${String(row.email || '').slice(0, 40) || '(blank)'}`)
        continue
      }

      if (seen.has(email)) {
        report.skipped++
        addReason('Duplicate row within the file')
        continue
      }
      seen.add(email)

      const paid = /paid|premium|founding|comp/i.test(String(row.plan || ''))
      const unsubscribed = /unsub|cancel|removed|bounce/i.test(String(row.status || ''))

      const existing = await database
        .selectFrom('publication_subscribers')
        .selectAll()
        .where('publication_id', '=', publication.id)
        .where('email', '=', email)
        .executeTakeFirst()

      if (existing) {
        await database.updateTable('publication_subscribers').set({
          name: String(row.name || '').trim().slice(0, 120) || existing.name,
          // Never un-unsubscribe somebody. Leaving has to stick.
          status: existing.status === 'unsubscribed' ? 'unsubscribed' : (unsubscribed ? 'unsubscribed' : 'active'),
          plan: paid ? 'paid' : existing.plan,
          updated_at: now(),
        }).where('id', '=', existing.id).execute()
        report.updated++
        continue
      }

      await database.insertInto('publication_subscribers').values({
        uuid: uuid(),
        email,
        name: String(row.name || '').trim().slice(0, 120) || null,
        // Already confirmed: they opted in on the platform they came from, and
        // re-confirming an imported list is how you lose most of it.
        status: unsubscribed ? 'unsubscribed' : 'active',
        plan: paid ? 'paid' : 'free',
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_end: null,
        cancels_at: null,
        confirmation_token: null,
        unsubscribe_token: crypto.randomUUID().replace(/-/g, ''),
        confirmed_at: now(),
        source: 'import',
        source_entry_id: null,
        publication_id: publication.id,
        created_at: now(),
        updated_at: now(),
      }).execute()
      report.imported++
    }

    if (rows.length > MAX_ROWS) {
      report.skipped += rows.length - MAX_ROWS
      addReason(`Only the first ${MAX_ROWS} rows were imported. Split the file and run it again.`)
    }

    await subscribers.refreshSubscriberCount()

    return report
  }

  /**
   * Import posts into the archive.
   *
   * Keyed on slug, so a re-run updates rather than duplicating. Imported posts
   * feed the long-form Discover entry through the same path a fresh publish
   * does, which is what keeps one write path for the feed.
   */
  async importPosts(rows: PostImportRow[]): Promise<ImportReport> {
    const publication = await publications.ensurePublication()
    const report: ImportReport = { imported: 0, updated: 0, skipped: 0, reasons: [] }

    const addReason = (reason: string) => {
      if (report.reasons.length < 10 && !report.reasons.includes(reason)) report.reasons.push(reason)
    }

    for (const row of rows.slice(0, MAX_ROWS)) {
      const title = String(row.title || '').trim()
      const body = String(row.body || '').trim()

      if (!title || !body) {
        report.skipped++
        addReason('A post needs both a title and a body')
        continue
      }

      const slug = String(row.slug || '').trim() || title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/[\s-]+/g, '-')
        .slice(0, 80)

      const publishedAt = this.timestamp(row.publishedAt)
      const existing = await database
        .selectFrom('blog_posts')
        .selectAll()
        .where('slug', '=', slug)
        .executeTakeFirst()

      if (existing) {
        await database.updateTable('blog_posts').set({
          title: title.slice(0, 200),
          body,
          excerpt: body.slice(0, 280),
          published_at: publishedAt,
          updated_at: now(),
        }).where('id', '=', existing.id).execute()
        report.updated++
      }
      else {
        await database.insertInto('blog_posts').values({
          uuid: uuid(),
          title: title.slice(0, 200),
          slug,
          body,
          excerpt: body.slice(0, 280),
          status: 'published',
          published_at: publishedAt,
          account_id: publication.id ? await this.accountId() : null,
          created_at: now(),
          updated_at: now(),
        }).execute()
        report.imported++
      }

      // Same write path a fresh publish uses, so an imported archive is
      // discoverable on exactly the same terms as new writing. Returns null
      // while the publication is unlisted, which is the correct no-op.
      try {
        await discover.record({
          form: 'long',
          sourceKey: `blog:${slug}`,
          title,
          body,
          url: `/blog/${slug}`,
          publishedAt,
        })
      }
      catch (error) {
        addReason(`Imported but not indexed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return report
  }

  /** Import readers straight from a CSV export. */
  async importSubscriberCsv(csv: string): Promise<ImportReport> {
    const rows = parseCsv(csv)
    if (!rows.length) throw new Error('That file has no rows, or no header line.')

    return await this.importSubscribers(rows.map(subscriberFromCsvRow))
  }

  private async accountId(): Promise<number | null> {
    const account = await database.selectFrom('accounts').select(['id']).orderBy('id', 'asc').executeTakeFirst()
    return account ? Number(account.id) : null
  }

  private timestamp(value: unknown): string {
    const date = new Date(String(value || ''))
    return Number.isNaN(date.getTime()) ? now() : date.toISOString().slice(0, 19).replace('T', ' ')
  }
}

export const imports = new ImportService()
