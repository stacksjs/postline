import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { discover } from '../../Services/DiscoverService'

export default new Action({
  name: 'The Open Times Discover Entry Status',
  description: 'Hide one of your own entries from the Discover feeds, or restore it.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      await discover.setStatus(
        Number(request.get('entry_id') || 0),
        String(request.get('status') || 'hidden') === 'visible' ? 'visible' : 'hidden',
      )

      return response.json({ ok: true, data: { updated: true } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
