import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { withHeartbeat } from '../Support/heartbeat'
import { housekeeping } from '../Services/HousekeepingService'

export default new Job({
  name: 'PruneLocalData',
  description: 'Remove old local copies (mentions, timeline, messages, logs) so the database stops growing',
  queue: 'default',
  tries: 1,
  backoff: 3,
  rate: Every.Day,

  handle: async () => await withHeartbeat('PruneLocalData', async () => {
    const removed = await housekeeping.prune()
    const total = Object.values(removed).reduce((sum, count) => sum + count, 0)
    if (total) log.info(`[postline] pruned ${total} old local rows: ${JSON.stringify(removed)}`)
    return removed
  }),
})
