import type { RecoveryFile, RecoveryManifest } from '../app/Services/RecoveryBackupService'
import { Database } from 'bun:sqlite'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { decryptBackupFile, restoreFromConfig } from 'ts-backups'
import { RECOVERY_FILES } from '../app/Services/RecoveryBackupService'
import { verifyRecoveryMedia } from '../app/Support/Recovery/media'
import { restorePublishedBlog } from '../app/Support/Social/blog-files'

const [set, destination] = process.argv.slice(2)
if (!set || !destination)
  throw new Error('Usage: bun scripts/restore-workspace.ts <downloaded recovery set> <new output directory>')

const configuredKey = process.env.POSTLINE_BACKUP_RECOVERY_KEY
const recoveryKey = configuredKey && !configuredKey.startsWith('encrypted:')
  ? configuredKey
  : await Bun.secrets.get({ service: 'postline-production-backups', name: 'recovery-key' })
if (!recoveryKey || recoveryKey.length < 32)
  throw new Error('Provide the backup recovery key in POSTLINE_BACKUP_RECOVERY_KEY or the Postline Keychain entry.')

const manifest = await Bun.file(join(set, 'complete.json')).json() as RecoveryManifest
if (manifest.version !== 1 || !manifest.files)
  throw new Error('The recovery set has an unsupported manifest.')

const output = resolve(destination)
await mkdir(output, { mode: 0o700 })
try {
  for (const kind of Object.keys(RECOVERY_FILES) as RecoveryFile[]) {
    const entry = manifest.files[kind]
    if (!entry || !/^[\w.-]+\.enc$/.test(entry.filename) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1)
      throw new Error(`The recovery manifest is missing a valid ${kind} file.`)
    const source = join(set, entry.filename)
    if (Bun.file(source).size !== entry.bytes)
      throw new Error(`The downloaded ${kind} file does not match the manifest.`)
    const target = join(output, RECOVERY_FILES[kind])
    await decryptBackupFile(source, target, recoveryKey)
    await chmod(target, 0o600)
  }

  const database = new Database(join(output, RECOVERY_FILES.database), { readonly: true })
  try {
    const result = database.query<{ quick_check: string }, []>('PRAGMA quick_check').get()
    if (result?.quick_check !== 'ok') throw new Error('The recovered SQLite database failed its integrity check.')
    await restorePublishedBlog(database, join(output, 'blog'))
  }
  finally {
    database.close()
  }

  const media = join(output, 'media')
  await mkdir(media, { mode: 0o700 })
  const restored = await restoreFromConfig({ verbose: false, outputPath: output, databases: [], files: [{ name: 'media', path: media }] }, { snapshot: RECOVERY_FILES.media })
  if (restored.successCount !== 1) throw new Error('The recovered media archive could not be expanded.')
  await verifyRecoveryMedia(join(output, RECOVERY_FILES.database), media)
  await rm(join(output, RECOVERY_FILES.media))
}
catch (error) {
  await rm(output, { recursive: true, force: true })
  throw error
}

console.log(`Verified and decrypted the recovery set into ${output}.`)
