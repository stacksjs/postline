import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { finishInstagramPageSelection } from '../../Support/Social/instagram-page-selection'
import { workspaceOwner } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Instagram Page Select',
  description: 'Connect the selected Instagram Page.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const owner = await workspaceOwner(request)
    if (owner === undefined) return response.unauthorized('Unauthorized')

    try {
      return await finishInstagramPageSelection(request, owner)
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
