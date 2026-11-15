import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { newsletter } from '../Services/NewsletterService'

export default new Job({
  name: 'DeliverNewsletters',
  description: 'Deliver queued newsletter sends in resumable batches.',
  queue: 'default',
  tries: 1,
  backoff: 30,
  rate: Every.Minute,

  handle: async () => {
    try {
      const result = await newsletter.deliverPending()
      if (result.delivered || result.failed)
        console.log(`[postline] newsletter: ${result.delivered} delivered, ${result.failed} failed across ${result.sends} send(s)`)
      return result
    }
    catch (error) {
      // Never throw: a retry would restart delivery from the job's start, and
      // the send row already tracks its own cursor for the next tick.
      return { sends: 0, delivered: 0, failed: 0, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
