import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'
import { workspaceXBrowserErrors } from '../../Support/Localization/workspace'
import { twitterBrowserDelete } from '../../Services/Social/TwitterBrowserDeleteService'
import { supportsLocalTwitterBrowser } from '../../Services/Social/TwitterBrowserSession'

export default new Action({
  name: 'Postline Delete X Browser Post',
  description: 'Verify, authorize, or record deletion of one published X post from the Mac browser.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!supportsLocalTwitterBrowser())
      return response.json({ ok: false, error: workspaceXBrowserErrors.desktopOnly }, { status: 404 })
    try {
      const operation = request.get('operation')
      const targetId = Number(request.get('target_id'))
      const receipt = request.get('receipt')
      let data: unknown
      if (operation === 'result') {
        data = await twitterBrowserDelete.result(request.get('token'), request.get('state'))
      }
      else if (!Number.isSafeInteger(targetId) || targetId < 1) {
        throw new UserFacingError('Select a published X browser post.')
      }
      else {
        switch (operation) {
          case 'prepare': data = await twitterBrowserDelete.prepare(targetId); break
          case 'authorize': data = await twitterBrowserDelete.authorize(targetId, receipt); break
          case 'attention': data = await twitterBrowserDelete.attention(targetId, receipt); break
          default: throw new UserFacingError('Postline could not read the X deletion operation.')
        }
      }
      return response.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
