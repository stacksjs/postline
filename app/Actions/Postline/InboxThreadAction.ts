import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'Postline Inbox Thread',
  description: 'Read one direct-message conversation.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      // Reading is all a GET may do. Marking the conversation read also
      // marks it read on the network, so the client asks for that separately
      // with a POST to /inbox/read.
      const data = await directMessages.thread(
        Number(request.get('conversation_id') || 0),
        { markRead: false },
      )

      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
