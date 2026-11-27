import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { twitterBrowserSession } from '../../Services/Social/TwitterBrowserSession'
import { isDesktopAgent } from '../../Support/Auth/native'
import { actionFailure } from '../../Support/Http/action-error'
import { workspaceXBrowserErrors } from '../../Support/Localization/workspace'

export default new Action({
  name: 'Postline X Browser Session',
  description: 'Read the local browser profile name and last verified X handle.',
  method: 'GET',

  async handle() {
    if (!isDesktopAgent())
      return response.json({ ok: false, error: workspaceXBrowserErrors.desktopOnly }, { status: 404 })
    try {
      return response.json({ ok: true, data: await twitterBrowserSession() }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
