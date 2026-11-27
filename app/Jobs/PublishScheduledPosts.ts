import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { recurringPosts } from '../Services/RecurringPostService'
import { withHeartbeat } from '../Support/heartbeat'
import { postQueue } from '../Services/Social/QueueService'

export default new Job({
  name: 'PublishScheduledPosts',
  description: 'Publish scheduled Postline posts whose time has come',
  queue: 'default',
  tries: 1,
  backoff: 3,
  rate: Every.Minute,

  handle: async () => await withHeartbeat('PublishScheduledPosts', async () => {
    const recurring = await recurringPosts.queueDue().catch((error) => {
      log.error(`[postline] could not check recurring posts: ${error instanceof Error ? error.message : String(error)}`)
      return null
    })
    if (recurring && (recurring.queued || recurring.skipped || recurring.paused))
      log.info(`[postline] recurring posts: ${recurring.queued} queued, ${recurring.skipped} skipped, ${recurring.paused} paused`)
    const { published, failed, missed } = await postQueue.publishDue()
    if (published || failed || missed)
      log.info(`[postline] scheduled publish run: ${published} published, ${failed} failed, ${missed} held back as missed`)
    return { published, failed, missed }
  }),
})
