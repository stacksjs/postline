import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { instagram } from '../../Services/Social/InstagramService'
import { stageInstagramPageSelection } from '../../Support/Social/instagram-page-selection'
import { finishNetworkConsent } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Instagram Callback',
  description: 'Finish Instagram OAuth consent and ask the owner to choose a Page.',
  method: 'GET',

  async handle(request: RequestInstance) {
    return finishNetworkConsent(request, 'instagram', async (code, options, owner) => {
      const selection = await instagram.exchangeAuthorizationCode(code, options)
      if (selection) return stageInstagramPageSelection(owner, selection)
    })
  },
})
