import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { trackedLinks } from '../../Services/TrackedLinkService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Tracked Link List',
  description: 'List short links and their all-time redirect totals.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await trackedLinks.list() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
