import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { instagram } from '../../Services/Social/InstagramService'
import { finishNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Instagram Callback',
  description: 'Finish Instagram OAuth consent and store the connected account.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return finishNetworkConsent(request, 'instagram', code => instagram.exchangeAuthorizationCode(code))
  },
})
