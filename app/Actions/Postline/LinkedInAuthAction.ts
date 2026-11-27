import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { linkedin } from '../../Services/Social/LinkedInService'
import { redirectToNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline LinkedIn Auth',
  description: 'Redirect the owner to LinkedIn for OAuth consent.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return redirectToNetworkConsent(request, 'linkedin', () => linkedin.prepareAuthorization())
  },
})
