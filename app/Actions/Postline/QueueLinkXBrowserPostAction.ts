import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'
import { supportsLocalTwitterBrowser } from '../../Services/Social/TwitterBrowserSession'
import { actionFailure } from '../../Support/Http/action-error'
import { workspaceXBrowserErrors } from '../../Support/Localization/workspace'

export default new Action({
  name: 'Postline Link X Browser Post',
  description: 'Link an observed X post to its uncertain Queue submission.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!supportsLocalTwitterBrowser())
      return response.json({ ok: false, error: workspaceXBrowserErrors.desktopOnly }, { status: 404 })
    try {
      return response.json({ ok: true, data: await postQueue.linkXBrowserPost(Number(request.get('target_id')), request.get('post')) })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
