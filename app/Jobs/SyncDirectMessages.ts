import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { withHeartbeat } from '../Support/heartbeat'
import { directMessages } from '../Services/DirectMessageService'

export default new Job({
  name: 'SyncDirectMessages',
  description: 'Pull new direct messages from every connected social network.',
  queue: 'default',
  tries: 1,
  backoff: 10,
  rate: Every.FiveMinutes,

  handle: async () => await withHeartbeat('SyncDirectMessages', async () => {
    try {
      const result = await directMessages.sync()
      if (result.messages)
        log.info(`[postline] dm sync: ${result.messages} new messages across ${result.conversations} conversations`)
      return result
    }
    catch (error) {
      // One network that is down does not land here: `sync` collects
      // per-network errors. Reaching here means something broader broke.
      // The job has one try, so this is recorded, not retried at once.
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[postline] dm sync failed: ${message}`)
      // Thrown again after logging: a run that failed as a whole is recorded
      // as failed on the job's heartbeat and shown on Activity, instead of
      // looking like a run that found nothing to do.
      throw error
    }
  }),
})
