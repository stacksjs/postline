import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { bluesky } from '../Services/Social/BlueskyService'

export default new Job({
  name: 'SyncEngagementMetrics',
  description: 'Refresh Bluesky engagement counts into post_targets.metrics',
  queue: 'default',
  tries: 1,
  backoff: 3,
  rate: Every.HalfHour,

  handle: async () => {
    try {
      const { synced } = await bluesky.syncMetrics()
      if (synced) log.info(`[postline] engagement sync: ${synced} targets refreshed`)
      return { synced }
    }
    catch (error) {
      // No connected account yet is normal on fresh installs, so this is not
      // an error, but it is recorded: a sync that quietly stopped working
      // looked exactly the same as one with nothing to do.
      const reason = error instanceof Error ? error.message : String(error)
      log.warn(`[postline] engagement sync skipped: ${reason}`)
      return { synced: 0, skipped: reason }
    }
  },
})
