import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'
import { BackupType, createBackup } from 'ts-backups'
import { mediaDirectory } from '../Support/Social/uploads'

const RECOVERY_KEY_ENV = 'POSTLINE_BACKUP_RECOVERY_KEY'
export const RECOVERY_FILES = { database: 'postline.sqlite', media: 'media.tsbak.gz', key: 'app-key' } as const
export type RecoveryFile = keyof typeof RECOVERY_FILES

export interface RecoveryManifest {
  version: 1
  createdAt: string
  files: Record<RecoveryFile, { filename: string, bytes: number }>
}

export async function backupWorkspace(collection: 'snapshots' | 'rehearsals' = 'snapshots'): Promise<{ bucket: string, prefix: string }> {
  const bucket = process.env.POSTLINE_BACKUP_BUCKET?.trim()
  const accessKeyId = process.env.POSTLINE_BACKUP_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.POSTLINE_BACKUP_SECRET_ACCESS_KEY?.trim()
  const recoveryKey = process.env.POSTLINE_BACKUP_RECOVERY_KEY
  const appKey = process.env.APP_KEY
  if (!bucket || !accessKeyId || !secretAccessKey || !recoveryKey || recoveryKey.length < 32)
    throw new Error('Postline backup bucket credentials and recovery key are required.')
  if (!appKey || appKey.startsWith('encrypted:') || recoveryKey === appKey)
    throw new Error('Postline backups need the application key and a separate recovery key.')
  if (process.env.DB_CONNECTION !== 'sqlite' || !process.env.DB_DATABASE_PATH)
    throw new Error('Configure the server’s SQLite database path before running Postline backups.')

  const region = process.env.POSTLINE_BACKUP_REGION || 'us-east-1'
  const createdAt = new Date().toISOString()
  const prefix = `${collection}/${createdAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}`
  const temporary = await mkdtemp(join(tmpdir(), 'postline-backup-'))
  const keyPath = join(temporary, 'app-key')
  const media = mediaDirectory()
  try {
    await mkdir(media, { recursive: true })
    await writeFile(keyPath, appKey, { flag: 'wx', mode: 0o600 })

    const credentials = { accessKeyId, secretAccessKey }
    const backup = await createBackup({
      verbose: false,
      outputPath: join(temporary, 'artifacts'),
      databases: [{ type: BackupType.SQLITE, name: 'database', path: process.env.DB_DATABASE_PATH, mode: 'file', compress: false }],
      files: [
        { name: 'media', path: media, compress: true, followSymlinks: false },
        { name: 'key', path: keyPath, compress: false },
      ],
      destinations: [{ type: 's3', bucket, prefix, region, credentials, optional: false, encryption: { keyEnv: RECOVERY_KEY_ENV } }],
    })

    const files = {} as RecoveryManifest['files']
    for (const name of Object.keys(RECOVERY_FILES) as RecoveryFile[]) {
      const artifact = backup.results.find(result => result.name === name && result.success)
      const upload = artifact && backup.uploads?.find(result => result.filename === basename(artifact.filename))
      if (!upload?.success || upload.skipped || !upload.bytes)
        throw new Error(`The ${name} backup could not be verified in S3.`)
      files[name] = { filename: basename(upload.target), bytes: upload.bytes }
    }

    // Restore only chooses a set whose three encrypted objects were verified.
    const client = new Bun.S3Client({ bucket, region, ...credentials })
    const complete: RecoveryManifest = { version: 1, createdAt, files }
    await client.write(`${prefix}/complete.json`, JSON.stringify(complete), { type: 'application/json' })
    return { bucket, prefix }
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
