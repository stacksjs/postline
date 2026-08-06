import { Job } from '@stacksjs/queue'
import { Every } from '@stacksjs/types'
import { keywordMonitoring } from '../Services/KeywordMonitoringService'

export default new Job({
  name: 'ScanKeywordMonitors',
  description: 'Search connected social networks for new keyword mentions.',
  queue: 'default',
  tries: 1,
  backoff: 10,
  rate: Every.FiveMinutes,

  handle: async () => {
    try {
      const result = await keywordMonitoring.scan()
      if (result.created)
        console.log(`[opentimes] listening scan: ${result.created} new mentions across ${result.scanned} rules`)
      return result
    }
    catch (error) {
      return { scanned: 0, found: 0, created: 0, errors: [{ message: error instanceof Error ? error.message : String(error) }] }
    }
  },
})
