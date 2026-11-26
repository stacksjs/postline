import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { workspaceArchive } from '../../Services/WorkspaceArchiveService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Workspace Delete',
  description: 'Delete everything in this workspace on this install, behind a typed confirmation. Nothing on the networks is touched.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      return response.json({ ok: true, data: await workspaceArchive.deleteEverything(String(request.get('confirmation') || '')) })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
