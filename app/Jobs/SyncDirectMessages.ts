import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { directMessages } from '../Services/DirectMessageService'
import { publicInbox } from '../Services/PublicInboxService'
import { withHeartbeat } from '../Support/heartbeat'

export default new Job({
  name: 'SyncDirectMessages',
  description: 'Pull direct messages, public replies and mentions from connected networks.',
  queue: 'default',
  tries: 1,
  backoff: 10,
  rate: Every.FiveMinutes,

  handle: async () => await withHeartbeat('SyncDirectMessages', async () => {
    try {
      const result = await directMessages.sync()
      if (result.messages)
        log.info(`[postline] dm sync: ${result.messages} new messages across ${result.conversations} conversations`)
      const mentions = await publicInbox.sync()
      if (mentions.added) log.info(`[postline] inbox sync: ${mentions.added} public replies and mentions`)
      return { ...result, publicInbox: mentions }
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
