import type { RequestInstance } from '@stacksjs/types'
import type { AppNetwork } from '../../Services/NetworkAppService'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { APP_NETWORKS, networkApps } from '../../Services/NetworkAppService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Network App Clear',
  description: 'Forget the stored owner app on a network.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const provider = String(request.get('provider') || '') as AppNetwork
    if (!APP_NETWORKS.includes(provider))
      return response.json({ ok: false, error: 'That network does not use an app of its own.' }, { status: 422 })
    try {
      await networkApps.clear(provider)
      return response.json({ ok: true, data: { apps: await networkApps.summary() } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
