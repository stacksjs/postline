import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { twitter } from '../../Services/Social/TwitterService'
import { finishNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Twitter Callback',
  description: 'Finish X/Twitter OAuth consent and store the connected account.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return finishNetworkConsent(request, 'twitter', (code, verifier) => twitter.exchangeAuthorizationCode(code, verifier))
  },
})
