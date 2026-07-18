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
    const { published, failed } = await postQueue.publishDue()
    if (published || failed)
      console.log(`[postline] scheduled publish run: ${published} published, ${failed} failed`)
    return { published, failed }
  },
})
