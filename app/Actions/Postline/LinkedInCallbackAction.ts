import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { linkedin } from '../../Services/Social/LinkedInService'
import { finishNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline LinkedIn Callback',
  description: 'Finish LinkedIn OAuth consent and store the connected account.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return finishNetworkConsent(request, 'linkedin', (code, options) => linkedin.exchangeAuthorizationCode(code, options))
  },
})
