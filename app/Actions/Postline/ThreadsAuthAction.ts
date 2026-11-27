import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { threads } from '../../Services/Social/ThreadsService'
import { redirectToNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Threads Auth',
  description: 'Redirect the owner to Threads for OAuth consent.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return redirectToNetworkConsent(request, 'threads', () => threads.prepareAuthorization())
  },
})
