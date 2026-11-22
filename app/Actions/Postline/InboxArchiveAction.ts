import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'Postline Inbox Archive',
  description: 'Archive a conversation, or restore it to the inbox.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const conversation = await directMessages.setStatus(
        Number(request.get('conversation_id') || 0),
        String(request.get('status') || 'archived') === 'open' ? 'open' : 'archived',
      )

      return response.json({ ok: true, data: { conversation } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
