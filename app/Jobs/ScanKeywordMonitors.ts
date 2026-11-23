import { log } from '@stacksjs/logging'
import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { withHeartbeat } from '../Support/heartbeat'
import { keywordMonitoring } from '../Services/KeywordMonitoringService'

export default new Job({
  name: 'ScanKeywordMonitors',
  description: 'Search connected social networks for new keyword mentions.',
  queue: 'default',
  tries: 1,
  backoff: 10,
  rate: Every.FiveMinutes,

  handle: async () => await withHeartbeat('ScanKeywordMonitors', async () => {
    try {
      const result = await keywordMonitoring.scan()
      if (result.created)
        log.info(`[postline] listening scan: ${result.created} new mentions across ${result.scanned} rules`)
      return result
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[postline] listening scan failed: ${message}`)
      return { scanned: 0, found: 0, created: 0, errors: [{ message }] }
    }
  }),
})
