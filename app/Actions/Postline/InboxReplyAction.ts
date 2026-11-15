import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'Postline Inbox Reply',
  description: 'Send a reply into an existing direct-message conversation.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const message = await directMessages.reply(
        Number(request.get('conversation_id') || 0),
        String(request.get('body') || ''),
      )

      return response.json({ ok: true, data: { message } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
