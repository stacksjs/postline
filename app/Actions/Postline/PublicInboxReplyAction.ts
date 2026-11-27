import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publicInbox } from '../../Services/PublicInboxService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Public Inbox Reply',
  description: 'Send a public reply from the account that received a mention or reply.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const data = await publicInbox.reply(Number(request.get('id')), request.get('text'))
      return response.json({ ok: true, data }, { status: data.status === 'sent' ? 200 : 202 })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
