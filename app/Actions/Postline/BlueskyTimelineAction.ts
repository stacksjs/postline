import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { bluesky } from '../../Services/Social/BlueskyService'

export default new Action({
  name: 'Postline Bluesky Timeline',
  description: 'Fetch and cache the connected Bluesky home timeline.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const limit = Number(request.get('limit') || 30)
    // Optional: which connected account's timeline. Omitted, the default one.
    const identityId = Number(request.get('identity_id') || 0) || null

    try {
      const data = await bluesky.syncTimeline(limit, identityId)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
