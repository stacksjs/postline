import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publicInbox } from '../../Services/PublicInboxService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Public Inbox List',
  description: 'Load saved public replies and mentions.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      return response.json({ ok: true, data: await publicInbox.list(Number(request.get('offset') || 0)) })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
