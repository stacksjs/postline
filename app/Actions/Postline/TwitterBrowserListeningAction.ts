import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { keywordMonitoring } from '../../Services/KeywordMonitoringService'
import { requireTwitterBrowserHandle } from '../../Services/Social/TwitterBrowserSession'
import { isDesktopAgent } from '../../Support/Auth/native'
import { actionFailure } from '../../Support/Http/action-error'
import { workspaceXBrowserErrors } from '../../Support/Localization/workspace'

export default new Action({
  name: 'Postline Import X Browser Listening',
  description: 'Import visible X posts that match active browser-session watches.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!isDesktopAgent())
      return response.json({ ok: false, error: workspaceXBrowserErrors.desktopOnly }, { status: 404 })
    try {
      await requireTwitterBrowserHandle(request.get('handle'))
      return response.json({ ok: true, data: await keywordMonitoring.importTwitterBrowserPosts(request.get('posts')) })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
