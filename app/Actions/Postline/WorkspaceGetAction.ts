import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { workspace } from '../../Services/WorkspaceService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Workspace Get',
  description: 'The workspace name and time zone.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await workspace.profile() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
