import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { campaigns } from '../../Services/CampaignService'

export default new Action({
  name: 'The Open Times Campaign List',
  description: 'List launch campaigns and optionally load one planning board.',
  method: 'GET',

  async handle(request: RequestInstance) {
    try {
      const items = await campaigns.list()
      const requestedId = Number(request.get('id') || 0)
      const selectedId = requestedId || items[0]?.id || 0
      const selected = selectedId ? await campaigns.get(selectedId) : null
      return response.json({ ok: true, data: { campaigns: items, selected } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 404 })
    }
  },
})
