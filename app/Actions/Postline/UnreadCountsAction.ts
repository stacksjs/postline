import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { directMessages } from '../../Services/DirectMessageService'
import { keywordMonitoring } from '../../Services/KeywordMonitoringService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline unread counts',
  description: 'Unread Inbox messages and Listening mentions in the current workspace.',
  method: 'GET',

  async handle() {
    try {
      const [inbox, listening] = await Promise.all([directMessages.unreadCount(), keywordMonitoring.unreadCount()])
      return response.json({ ok: true, data: { inbox, listening } }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
