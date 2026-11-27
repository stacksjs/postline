import { Database } from 'bun:sqlite'
import { mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, parse } from 'node:path'
import { backupDatabase } from '@stacksjs/database/compiled-migrations'

const retiredPublicationTables = [
  'discover_entries',
  'post_comments',
  'publication_recommendations',
  'publication_sends',
  'publication_subscribers',
  'publication_tiers',
  'publications',
] as const

/**
 * Keep the retired product's data outside the active schema. Unlike ordinary
 * upgrade snapshots, this copy must survive later Postline updates.
 */
export function archiveRetiredPublications(databasePath: string): string | undefined {
  if (!statSync(databasePath, { throwIfNoEntry: false }))
    return undefined

  const database = new Database(databasePath, { readonly: true })
  try {
    const names = new Set(database.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(row => row.name))
    if (!retiredPublicationTables.some(table => names.has(table) && database.query(`SELECT 1 FROM "${table}" LIMIT 1`).get()))
      return undefined
  }
  finally {
    database.close()
  }

  const { dir: directory, name } = parse(databasePath)
  const destination = join(directory, `${name}.retired-publication.sqlite`)
  const staging = mkdtempSync(join(directory, '.publication-archive-'))
  try {
    const snapshot = join(staging, 'publication.sqlite')
    backupDatabase(databasePath, snapshot)
    renameSync(snapshot, destination)
  }
  finally {
    rmSync(staging, { recursive: true })
  }
  return destination
}
