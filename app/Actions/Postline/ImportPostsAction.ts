import type { RequestInstance } from '@stacksjs/types'
import type { PostImportRow } from '../../Services/ImportService'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { imports, parseCsv } from '../../Services/ImportService'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'

/** A CSV header for each field, in the spellings platform exports use. */
const COLUMNS: Record<keyof PostImportRow, string[]> = {
  title: ['title', 'name', 'headline'],
  body: ['body', 'content', 'text', 'markdown', 'html'],
  slug: ['slug'],
  publishedAt: ['publishedat', 'published_at', 'published', 'date', 'created_at'],
  url: ['url', 'link'],
}

/** One CSV record (headers lower-cased by parseCsv) as an import row. */
export function rowFromCsv(record: Record<string, string>): PostImportRow {
  const row: PostImportRow = {}
  for (const [field, names] of Object.entries(COLUMNS) as Array<[keyof PostImportRow, string[]]>) {
    const name = names.find(candidate => candidate in record)
    if (name) row[field] = record[name]
  }
  return row
}

export default new Action({
  name: 'Postline Import Posts',
  description: 'Import an archive of long-form posts into the blog, from JSON or CSV. `dry_run` previews it.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const dryRun = ['1', 'true', 'on'].includes(String(request.get('dry_run') || '').toLowerCase())
      const csv = request.get('csv')
      let rows: PostImportRow[]

      if (typeof csv === 'string' && csv.trim()) {
        rows = parseCsv(csv).map(rowFromCsv)
      }
      else {
        const raw = request.get('posts')
        let parsed: unknown
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        }
        catch {
          throw new UserFacingError('That is not valid JSON. Send an array of { title, body, slug, publishedAt }, or a CSV file.')
        }
        if (!Array.isArray(parsed)) throw new UserFacingError('Send an array of { title, body, slug, publishedAt }, or a CSV file.')
        rows = parsed as PostImportRow[]
      }

      return response.json({ ok: true, data: { report: await imports.importPosts(rows, { dryRun }) } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
