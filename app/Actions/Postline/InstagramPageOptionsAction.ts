import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { previewInstagramPageSelection } from '../../Support/Social/instagram-page-selection'
import { workspaceOwner } from '../../Support/Social/network-oauth'

export default new Action({
  name: 'Postline Instagram Page Options',
  description: 'List the Pages authorized for this pending Instagram connection.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const owner = await workspaceOwner(request)
    if (owner === undefined) return response.unauthorized('Unauthorized')

    try {
      const pages = await previewInstagramPageSelection(request, owner)
      return Response.json({ ok: true, data: pages }, { headers: { 'Cache-Control': 'no-store' } })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
