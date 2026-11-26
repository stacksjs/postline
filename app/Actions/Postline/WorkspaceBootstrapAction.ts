import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { workspaceBootstrap } from '../../Services/WorkspaceBootstrapService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline workspace bootstrap',
  description: 'The workspace profile, connected channels, and unread counts.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await workspaceBootstrap() }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
