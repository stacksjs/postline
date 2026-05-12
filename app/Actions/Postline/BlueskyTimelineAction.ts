import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { bluesky } from '../../Services/Social/BlueskyService'

export default new Action({
  name: 'Postline Bluesky Timeline',
  description: 'Fetch and cache the connected Bluesky home timeline.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const limit = Number(request.get('limit') || 30)

    try {
      const data = await bluesky.syncTimeline(limit)
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
