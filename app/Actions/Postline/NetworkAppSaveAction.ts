import type { RequestInstance } from '@stacksjs/types'
import type { AppNetwork } from '../../Services/NetworkAppService'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { APP_NETWORKS, networkApps } from '../../Services/NetworkAppService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Network App Save',
  description: 'Store the client id and secret of the owner app on a network.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const provider = String(request.get('provider') || '') as AppNetwork
    if (!APP_NETWORKS.includes(provider))
      return response.json({ ok: false, error: 'That network does not use an app of its own.' }, { status: 422 })
    try {
      const data = await networkApps.save(provider, {
        clientId: String(request.get('client_id') || ''),
        clientSecret: String(request.get('client_secret') || ''),
        redirectUrl: String(request.get('redirect_url') || ''),
        ...(request.get('organization_pages') === undefined || request.get('organization_pages') === null
          ? {}
          : { organizationPages: ['1', 'true', 'on'].includes(String(request.get('organization_pages'))) }),
      })
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
