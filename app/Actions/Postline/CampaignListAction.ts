import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { campaigns } from '../../Services/CampaignService'
import { workspace } from '../../Services/WorkspaceService'

export default new Action({
  name: 'Postline Campaign List',
  description: 'List launch campaigns and optionally load one planning board.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const [items, workspaceTimezone] = await Promise.all([campaigns.list(), workspace.timezone()])
      const requestedId = Number(request.get('id') || 0)
      const selectedId = requestedId || items[0]?.id || 0
      const selected = selectedId ? await campaigns.get(selectedId) : null
      return response.json({ ok: true, data: { campaigns: items, selected, workspaceTimezone } })
    }
    catch (error) {
      return actionFailure(error, 404)
    }
  },
})
