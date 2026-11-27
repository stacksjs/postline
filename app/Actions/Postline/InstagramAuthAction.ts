import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { instagram } from '../../Services/Social/InstagramService'
import { redirectToNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Instagram Auth',
  description: 'Redirect the owner to Instagram for OAuth consent.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return redirectToNetworkConsent(request, 'instagram', () => instagram.prepareAuthorization())
  },
})
