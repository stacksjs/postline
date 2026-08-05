import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { discover } from '../../Services/DiscoverService'

export default new Action({
  name: 'Postline Discover Feed',
  description: 'Read the long-form and short-form Discover feeds.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const form = String(request.get('form') || '')
      // No `form` means the page is loading both feeds at once; asking for one
      // is the cheaper refresh a realtime client makes after an event.
      const data = form ? await discover.feed(form) : await discover.overview()

      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
