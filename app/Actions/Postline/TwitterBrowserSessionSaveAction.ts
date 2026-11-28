import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { pauseTwitterBrowserReads, rememberTwitterBrowserHandle, twitterBrowserSession } from '../../Services/Social/TwitterBrowserSession'
import { isDesktopAgent } from '../../Support/Auth/native'
import { actionFailure } from '../../Support/Http/action-error'
import { workspaceXBrowserErrors } from '../../Support/Localization/workspace'

export default new Action({
  name: 'Postline Save X Browser Session',
  description: 'Remember the confirmed X username or hold reads until the owner checks the browser.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!isDesktopAgent())
      return response.json({ ok: false, error: workspaceXBrowserErrors.desktopOnly }, { status: 404 })
    try {
      if (request.get('needs_check') === true)
        await pauseTwitterBrowserReads(request.get('needs_layout_check') === true ? 'layout' : 'sign-in')
      else await rememberTwitterBrowserHandle(request.get('signed_out') === true ? null : request.get('handle'), {
        checkedLayout: request.get('checked_layout') === true,
      })
      return response.json({ ok: true, data: await twitterBrowserSession() })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
