import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { workspaceUnreadCounts } from '../../Services/WorkspaceBootstrapService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline unread counts',
  description: 'Unread Inbox messages and Listening mentions in the current workspace.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await workspaceUnreadCounts() }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
