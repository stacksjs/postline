import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'Postline Inbox Thread',
  description: 'Read one direct-message conversation and mark it read.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const data = await directMessages.thread(
        Number(request.get('conversation_id') || 0),
        // `?mark_read=0` lets a background poll refresh an open thread without
        // clearing unread state the user has not actually looked at.
        { markRead: String(request.get('mark_read') || '1') !== '0' },
      )

      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
