import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { pauseTwitterBrowserReads, rememberTwitterBrowserHandle, twitterBrowserSession } from '../../Services/Social/TwitterBrowserSession'
import { isDesktopAgent } from '../../Support/Auth/native'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Save X Browser Session',
  description: 'Remember the confirmed X username or pause reads until the owner checks sign-in.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!isDesktopAgent())
      return response.json({ ok: false, error: 'X browser sessions are available in the Postline Mac app.' }, { status: 404 })
    try {
      if (request.get('needs_check') === true) await pauseTwitterBrowserReads()
      else await rememberTwitterBrowserHandle(request.get('signed_out') === true ? null : request.get('handle'))
      return response.json({ ok: true, data: await twitterBrowserSession() })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
