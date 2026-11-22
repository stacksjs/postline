import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'Postline Inbox Sync',
  description: 'Pull new direct messages from every connected network.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const data = await directMessages.sync({
        provider: String(request.get('provider') || ''),
        conversationId: Number(request.get('conversation_id') || 0),
      })

      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
