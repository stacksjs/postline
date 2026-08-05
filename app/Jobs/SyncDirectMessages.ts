import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { directMessages } from '../Services/DirectMessageService'

export default new Job({
  name: 'SyncDirectMessages',
  description: 'Pull new direct messages from every connected social network.',
  queue: 'default',
  tries: 1,
  backoff: 10,
  rate: Every.FiveMinutes,

  handle: async () => {
    try {
      const result = await directMessages.sync()
      if (result.messages)
        console.log(`[postline] dm sync: ${result.messages} new messages across ${result.conversations} conversations`)
      return result
    }
    catch (error) {
      // A network that is down should not fail the job and trigger retries —
      // `sync` already collects per-provider errors, so reaching here means
      // something broader broke and the next tick is the right retry.
      return { synced: 0, conversations: 0, messages: 0, errors: [{ message: error instanceof Error ? error.message : String(error) }] }
    }
  },
})
