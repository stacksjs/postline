import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { directMessages } from '../../Services/DirectMessageService'

export default new Action({
  name: 'Postline Inbox Sync',
  description: 'Refresh direct messages, with explicit X account selection for paid reads.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const twitterIdentity = request.get('twitter_identity_id')
      const data = twitterIdentity == null
        ? await directMessages.sync({
            provider: String(request.get('provider') || ''),
            conversationId: Number(request.get('conversation_id') || 0),
          })
        : await directMessages.syncTwitter(Number(twitterIdentity), request.get('older') === true)

      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
