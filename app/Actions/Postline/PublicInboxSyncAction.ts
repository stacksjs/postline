import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publicInbox } from '../../Services/PublicInboxService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Public Inbox Sync',
  description: 'Sync public replies and mentions from connected networks.',
  method: 'POST',

  async handle() {
    try {
      return response.json({ ok: true, data: await publicInbox.sync() })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
