import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { twitter } from '../../Services/Social/TwitterService'
import { redirectToNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Twitter Auth',
  description: 'Redirect the owner to X/Twitter for OAuth consent.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return redirectToNetworkConsent(request, 'twitter', () => twitter.prepareAuthorization())
  },
})
