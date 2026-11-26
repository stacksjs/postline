import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { workspace } from '../../Services/WorkspaceService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Workspace Save',
  description: 'Change the workspace name, the owner name or the time zone.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const field = (name: string): string | undefined => {
      const value = request.get(name)
      return value === undefined || value === null ? undefined : String(value)
    }

    try {
      const data = await workspace.save({
        name: field('name'),
        workspaceName: field('workspaceName'),
        timezone: field('timezone'),
        shareMediaByTunnel: field('shareMediaByTunnel') === undefined ? undefined : ['1', 'true', 'on'].includes(String(field('shareMediaByTunnel')).toLowerCase()),
        publishingPaused: field('publishingPaused') === undefined ? undefined : ['1', 'true', 'on'].includes(String(field('publishingPaused')).toLowerCase()),
      })
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
