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

import { publicMessage } from '../Support/Http/action-error'
import { blog } from './Social/BlogService'
import { now } from './Social/support'

/** Cap per run, so a pasted file cannot become an unbounded write loop. */
export const MAX_ROWS = 5000

export interface ImportReport {
  imported: number
  updated: number
  skipped: number
  /** Every row that was not imported, by its number in the file (1 is the first post), and why. */
  skippedRows: Array<{ row: number, reason: string }>
  /** The distinct reasons, so a bad file is diagnosable at a glance. */
  reasons: string[]
  /** True for a preview: nothing was written. */
  dryRun: boolean
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
   * Import posts into the blog, or with `dryRun` say what an import would do.
   *
   * Each post goes through BlogService, so it gets its file and appears on
   * the blog. A re-run updates rather than duplicating. Nothing is silent:
   * every row not imported is listed with its number and the reason,
   * including the rows past the per-run cap (#117).
   */
  async importPosts(rows: PostImportRow[], options: { dryRun?: boolean } = {}): Promise<ImportReport> {
    const report: ImportReport = { imported: 0, updated: 0, skipped: 0, skippedRows: [], reasons: [], dryRun: Boolean(options.dryRun) }
    const skip = (row: number, reason: string) => {
      report.skipped++
      report.skippedRows.push({ row, reason })
      if (!report.reasons.includes(reason)) report.reasons.push(reason)
    }

    const createdThisRun = new Set<string>()
    for (const [index, row] of rows.entries()) {
      const number = index + 1
      if (index >= MAX_ROWS) {
        skip(number, `Past the ${MAX_ROWS.toLocaleString('en-US')}-post limit for one import; import the rest as a second file`)
        continue
      }

      const title = String(row.title ?? '').trim()
      const body = String(row.body ?? '').trim()
      if (!title || !body) {
        skip(number, 'A post needs both a title and a body')
        continue
      }

      const publishedAt = this.timestamp(row.publishedAt)
      if (publishedAt === null) {
        skip(number, `"${String(row.publishedAt).slice(0, 40)}" is not a date Postline can read`)
        continue
      }

      try {
        const outcome = await blog.importPost({ title, body, slug: row.slug ? String(row.slug) : undefined, publishedAt }, { dryRun: options.dryRun, createdThisRun })
        if (outcome === 'created') report.imported++
        else report.updated++
      }
      catch (error) {
        skip(number, publicMessage(error, 'Could not be saved'))
      }
    }

    return report
  }

  /** The stored timestamp for a date given in the file: now when none is given, null when it cannot be read. */
  private timestamp(value: unknown): string | null {
    const given = String(value ?? '').trim()
    if (!given) return now()
    const date = new Date(given)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 19).replace('T', ' ')
  }
}

export const imports = new ImportService()
