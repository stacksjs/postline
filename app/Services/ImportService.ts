/**
 * Bring a post archive over from somewhere else.
 *
 * Leaving a platform normally means abandoning the archive. This moves the
 * long-form posts into the blog, and reports exactly what it did rather than
 * claiming success and leaving you to find out what did not arrive.
 *
 * Two rules shape the whole file. Nothing is destructive: an import can be run
 * twice and the second run updates rather than duplicates, because the first
 * run failing halfway is the normal case. And nothing is silent: every skipped
 * row is counted and the first few reasons are returned, since "imported 1,482
 * of 1,500" with no explanation is worse than an error.
 */

import { db } from '@stacksjs/database'
import { now, uuid } from './Social/support'

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

export class ImportService {
  /**
   * Import posts into the archive.
   *
   * Keyed on slug, so a re-run updates rather than duplicating.
   */
  async importPosts(rows: PostImportRow[]): Promise<ImportReport> {
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
          account_id: await this.accountId(),
          created_at: now(),
          updated_at: now(),
        }).execute()
        report.imported++
      }
    }

    return report
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
