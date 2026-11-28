import type { RequestInstance } from '@stacksjs/types'
import type { AppNetwork } from '../../Services/NetworkAppService'
import { Action } from '@stacksjs/actions'
import { APP_NETWORKS } from '../../Services/NetworkAppService'
import { instagram } from '../../Services/Social/InstagramService'
import { linkedin } from '../../Services/Social/LinkedInService'
import { threads } from '../../Services/Social/ThreadsService'
import { twitter } from '../../Services/Social/TwitterService'
import { allowsNativeAppWithoutLogin } from '../../Support/Auth/native'
import { actionFailure } from '../../Support/Http/action-error'
import { beginNativeNetworkConsent, nativeNetworkConsentResult } from '../../Support/Social/native-network-consent'

const networks = { instagram, linkedin, threads, twitter }

export default new Action({
  name: 'Postline Mac Network Consent',
  description: 'Start network consent in the system browser and pick up its result in Postline.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (!allowsNativeAppWithoutLogin()) return new Response(null, { status: 404 })
    const operation = request.get('operation')
    if (operation === 'result') return nativeNetworkConsentResult(request.get('id'))
    const provider = request.get('provider') as AppNetwork
    if (operation !== 'begin' || !APP_NETWORKS.includes(provider))
      return Response.json({ ok: false, error: 'Choose a network to connect.' }, { status: 422 })

    try {
      const authorization = await networks[provider].prepareAuthorization()
      const data = beginNativeNetworkConsent(provider, authorization, request.get('test') === true)
      return Response.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
