import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { keywordMonitoring } from '../../Services/KeywordMonitoringService'
import { supportsLocalTwitterBrowser } from '../../Services/Social/TwitterBrowserSession'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'
import { workspaceXBrowserErrors } from '../../Support/Localization/workspace'

export default new Action({
  name: 'Postline X Browser Listening Check',
  description: 'Claim or settle a paced X browser search from the local Mac app.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!supportsLocalTwitterBrowser())
      return response.json({ ok: false, error: workspaceXBrowserErrors.desktopOnly }, { status: 404 })

    try {
      const operation = request.get('operation')
      if (operation === 'claim') return response.json({ ok: true, data: await keywordMonitoring.claimTwitterBrowserScan() })
      if (operation !== 'finish') throw new UserFacingError(workspaceXBrowserErrors.invalidPosts)

      const data = await keywordMonitoring.finishTwitterBrowserScan(
        request.get('token'), request.get('handle'), request.get('state'), request.get('posts'),
      )
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
