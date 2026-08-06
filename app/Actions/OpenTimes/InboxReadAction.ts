import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'The Open Times Inbox Read',
  description: 'Mark one conversation, or the whole inbox, as read.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const updated = await directMessages.markRead(Number(request.get('conversation_id') || 0))

      return response.json({ ok: true, data: { updated } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
