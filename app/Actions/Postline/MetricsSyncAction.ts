import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { bluesky } from '../../Services/Social/BlueskyService'

export default new Action({
  name: 'Postline Metrics Sync',
  description: 'Refresh engagement metrics for published posts on demand.',
  method: 'POST',

  async handle() {
    try {
      const data = await bluesky.syncMetrics()
      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 422 })
    }
  },
})
