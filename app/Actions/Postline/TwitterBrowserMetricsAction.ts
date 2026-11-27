import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { saveTwitterBrowserMetrics } from '../../Services/Social/TwitterBrowserSession'
import { isDesktopAgent } from '../../Support/Auth/native'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Save X Browser Metrics',
  description: 'Record public metrics read from the owner’s visible X posts.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!isDesktopAgent())
      return response.json({ ok: false, error: 'X browser sessions are available in the Postline Mac app.' }, { status: 404 })
    try {
      const synced = await saveTwitterBrowserMetrics(request.get('handle'), request.get('measurements'))
      return response.json({ ok: true, data: { synced } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
