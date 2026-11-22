import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'Postline Inbox List',
  description: 'List direct-message conversations from the local mirror.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const data = await directMessages.list({
        status: String(request.get('status') || 'open'),
        provider: String(request.get('provider') || ''),
      })

      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
