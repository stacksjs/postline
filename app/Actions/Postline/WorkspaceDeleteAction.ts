import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { localTwitterProfileForErasure } from '../../Services/Social/TwitterBrowserSession'
import { workspaceArchive } from '../../Services/WorkspaceArchiveService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Workspace Delete',
  description: 'Delete everything in this workspace on this install, behind a typed confirmation. Nothing on the networks is touched.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const profile = await localTwitterProfileForErasure()
      if (profile && request.get('removedTwitterProfile') !== profile)
        return response.json({ ok: false, error: 'Delete the local X browser profile from Postline on this Mac before clearing the workspace.' }, { status: 409 })
      const result = await workspaceArchive.deleteEverything(String(request.get('confirmation') || ''))
      return response.json({ ok: true, data: result })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
