import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { withHeartbeat } from '../Support/heartbeat'
import { retention } from '../Services/RetentionService'

export default new Job({
  name: 'AutoDeletePosts',
  description: 'Delete posts older than the retention period set in Settings',
  queue: 'default',
  tries: 1,
  backoff: 3,
  rate: Every.Day,

  handle: async () => await withHeartbeat('AutoDeletePosts', async () => {
    try {
      const outcome = await retention.run()
      if (!outcome.ran) return { skipped: outcome.reason }

      const { result, settings } = outcome
      log.info(`[postline] auto-delete (> ${settings.days} days): ${result.deleted} deleted, ${result.failed} failed of ${result.matched} matched`)
      return { matched: result.matched, deleted: result.deleted, failed: result.failed }
    }
    catch (error) {
      // Per-network failures are already in purge_runs; this is the run itself.
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[postline] auto-delete failed: ${message}`)
      return { failed: true, error: message }
    }
  }),
})
