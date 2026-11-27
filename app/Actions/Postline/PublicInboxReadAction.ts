import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publicInbox } from '../../Services/PublicInboxService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Public Inbox Read',
  description: 'Mark a public reply or mention as read in Postline.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      await publicInbox.markRead(Number(request.get('id')))
      return response.json({ ok: true })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
