import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { twitterBrowserDispatch } from '../../Services/Social/TwitterBrowserDispatchService'
import { supportsLocalTwitterBrowser } from '../../Services/Social/TwitterBrowserSession'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'
import { workspaceXBrowserErrors } from '../../Support/Localization/workspace'

export default new Action({
  name: 'Postline X Browser Publish',
  description: 'Hand a pending post to the signed-in Mac browser and record its response.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!supportsLocalTwitterBrowser())
      return response.json({ ok: false, error: workspaceXBrowserErrors.desktopOnly }, { status: 404 })
    try {
      const token = request.get('token')
      let data: unknown
      switch (request.get('operation')) {
        case 'claim': data = twitterBrowserDispatch.claim(); break
        case 'authorize': data = await twitterBrowserDispatch.authorizeSubmit(token); break
        case 'result': data = await twitterBrowserDispatch.settle(token, request.get('result')); break
        default: throw new UserFacingError('Postline could not read the X browser publish operation.')
      }
      return response.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
