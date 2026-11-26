import process from 'node:process'
import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { backupWorkspace } from '../Services/RecoveryBackupService'
import { withHeartbeat } from '../Support/heartbeat'

export default new Job({
  name: 'BackupWorkspace',
  description: 'Send an encrypted recovery set to the Postline backup bucket',
  queue: 'default',
  tries: 1,
  backoff: 3,
  rate: Every.Day,

  handle: async () => {
    if (!['production', 'prod'].includes(process.env.APP_ENV ?? '') || !process.env.POSTLINE_BACKUP_BUCKET)
      return

    return await withHeartbeat('BackupWorkspace', async () => {
      const { bucket, prefix } = await backupWorkspace()
      log.info(`[postline] recovery set verified at s3://${bucket}/${prefix}/complete.json`)
    })
  },
})
