import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { threads } from '../../Services/Social/ThreadsService'
import { finishNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Threads Callback',
  description: 'Finish Threads OAuth consent and store the connected account.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return finishNetworkConsent(request, 'threads', code => threads.exchangeAuthorizationCode(code))
  },
})
