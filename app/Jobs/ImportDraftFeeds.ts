import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { draftFeeds } from '../Services/DraftFeedService'
import { withHeartbeat } from '../Support/heartbeat'

export default new Job({
  name: 'ImportDraftFeeds',
  description: 'Turn new entries in saved feeds into Queue drafts.',
  queue: 'default',
  tries: 1,
  backoff: 10,
  rate: Every.ThirtyMinutes,

  handle: async () => await withHeartbeat('ImportDraftFeeds', async () => {
    const result = await draftFeeds.checkAll()
    if (result.created) log.info(`[postline] feeds created ${result.created} drafts`)
    return result
  }),
})
