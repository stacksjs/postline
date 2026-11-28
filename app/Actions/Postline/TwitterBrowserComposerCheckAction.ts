import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { claimTwitterBrowserComposerCheck, finishTwitterBrowserComposerCheck } from '../../Services/Social/TwitterBrowserSession'
import { isDesktopAgent } from '../../Support/Auth/native'
import { actionFailure } from '../../Support/Http/action-error'
import { workspaceXBrowserErrors } from '../../Support/Localization/workspace'

export default new Action({
  name: 'Postline X Browser Composer Check',
  description: 'Claim or report a daily check of the signed-in X Composer.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!isDesktopAgent())
      return response.json({ ok: false, error: workspaceXBrowserErrors.desktopOnly }, { status: 404 })
    try {
      const data = request.get('begin') === true
        ? await claimTwitterBrowserComposerCheck()
        : { recorded: await finishTwitterBrowserComposerCheck(request.get('token'), request.get('health')) }
      return response.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
