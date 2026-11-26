import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
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
        { markRead: false, offset: Number(request.get('offset') || 0) },
      )

      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
