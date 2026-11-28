import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { allowsNativeAppWithoutLogin } from '../../Support/Auth/native'
import { launchNativeNetworkConsent, nativeNetworkConsentPage } from '../../Support/Social/native-network-consent'
import { networkOAuthRedirect } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Mac Network Consent Launch',
  description: 'Bind a desktop consent request to the system browser that opens it.',
  method: 'GET',

  async handle(request: RequestInstance) {
    if (!allowsNativeAppWithoutLogin()) return new Response(null, { status: 404 })
    const launch = await launchNativeNetworkConsent(request.get('ticket'))
    return launch ? networkOAuthRedirect(launch.url, launch.cookie) : nativeNetworkConsentPage(400)
  },
})
