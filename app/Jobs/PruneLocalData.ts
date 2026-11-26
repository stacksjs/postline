import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { withHeartbeat } from '../Support/heartbeat'
import { housekeeping } from '../Services/HousekeepingService'
import { postQueue } from '../Services/Social/QueueService'

export default new Job({
  name: 'PruneLocalData',
  description: 'Remove old local copies (mentions, timeline, messages, logs) so the database stops growing',
  queue: 'default',
  tries: 1,
  backoff: 3,
  rate: Every.Day,

  handle: async () => await withHeartbeat('PruneLocalData', async () => {
    const queuePosts = await postQueue.pruneExpiredRemovals()
    if (queuePosts) log.info(`[postline] permanently removed ${queuePosts} deleted queue posts`)
    const removed = await housekeeping.prune()
    const total = Object.values(removed).reduce((sum, count) => sum + count, 0)
    if (total) log.info(`[postline] pruned ${total} old local rows: ${JSON.stringify(removed)}`)
    // Monthly; a failure waits for tomorrow's run rather than failing this one.
    try {
      if (await housekeeping.vacuumIfDue() === 'vacuumed') log.info('[postline] compacted the database')
    }
    catch (error) {
      log.warn(`[postline] could not compact the database: ${error instanceof Error ? error.message : String(error)}`)
    }
    return removed
  }),
})
