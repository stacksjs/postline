import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { postQueue } from '../Services/Social/QueueService'

export default new Job({
  name: 'PublishScheduledPosts',
  description: 'Publish scheduled Postline posts whose time has come',
  queue: 'default',
  tries: 1,
  backoff: 3,
  rate: Every.Minute,

  handle: async () => {
    const { published, failed, missed } = await postQueue.publishDue()
    if (published || failed || missed)
      log.info(`[postline] scheduled publish run: ${published} published, ${failed} failed, ${missed} held back as missed`)
    return { published, failed, missed }
  },
})
