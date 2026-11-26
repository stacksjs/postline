import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { workspaceArchive } from '../../Services/WorkspaceArchiveService'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'

export default new Action({
  name: 'Postline Workspace Import',
  description: 'Bring in a workspace export from another install. Rows already here are left as they are.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const raw = request.get('archive')
      let archive: unknown
      try {
        archive = typeof raw === 'string' ? JSON.parse(raw) : raw
      }
      catch {
        throw new UserFacingError('That file is not a Postline workspace export.')
      }
      return response.json({ ok: true, data: { report: await workspaceArchive.import(archive) } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
