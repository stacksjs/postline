import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'The Open Times Inbox List',
  description: 'List direct-message conversations from the local mirror.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const data = await directMessages.list({
        status: String(request.get('status') || 'open'),
        provider: String(request.get('provider') || ''),
      })

      return response.json({ ok: true, data })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
