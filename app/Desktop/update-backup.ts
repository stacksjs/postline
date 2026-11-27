import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { backupDatabase } from '@stacksjs/database/compiled-migrations'

const backupsKept = 3
const backupPrefix = 'postline.before-update-'

export function backupBeforeDesktopUpdate(databasePath: string): string {
  if (!statSync(databasePath).isFile())
    throw new Error('The workspace database is not a file.')

  const directory = join(dirname(databasePath), 'update-backups')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const filename = `${backupPrefix}${stamp}-${randomUUID()}.sqlite`
  const destination = join(directory, filename)
  const staging = `${destination}.partial`
  try {
    backupDatabase(databasePath, staging)
    renameSync(staging, destination)
  }
  finally {
    rmSync(staging, { force: true })
  }

  const older = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith(backupPrefix) && entry.name.endsWith('.sqlite') && entry.name !== filename)
    .map(entry => entry.name)
    .sort()
    .reverse()
  for (const backup of older.slice(backupsKept - 1))
    rmSync(join(directory, backup), { force: true })

  return destination
}
