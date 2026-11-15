import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
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
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
