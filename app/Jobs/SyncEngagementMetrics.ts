import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { withHeartbeat } from '../Support/heartbeat'
import { syncEngagement } from '../Services/Social/EngagementService'

export default new Job({
  name: 'SyncEngagementMetrics',
  description: 'Refresh engagement counts for published posts',
  queue: 'default',
  tries: 1,
  backoff: 3,
  rate: Every.HalfHour,

  handle: async () => await withHeartbeat('SyncEngagementMetrics', async () => {
    const result = await syncEngagement()
    if (result.synced) log.info(`[postline] engagement sync: ${result.synced} targets refreshed`)
    for (const error of result.errors) log.warn(`[postline] ${error.provider} engagement sync skipped: ${error.explanation}`)
    return result
  }),
})
