import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { discover } from '../../Services/DiscoverService'

export default new Action({
  name: 'Postline Discover Read',
  description: 'Count a read against a Discover entry.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      await discover.recordRead(Number(request.get('entry_id') || 0))

      return response.json({ ok: true, data: { recorded: true } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
