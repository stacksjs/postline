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
      if (synced) console.log(`[postline] engagement sync: ${synced} targets refreshed`)
      return { synced }
    }
    catch (error) {
      // No connected account yet is normal on fresh installs — stay quiet.
      return { synced: 0, skipped: error instanceof Error ? error.message : String(error) }
    }
  },
})
